import type {
  Db0Backend,
  LogAppendOpts,
  LogEntry,
  MemoryContent,
  MemoryEdge,
  MemoryEdgeWriteOpts,
  MemoryEntry,
  MemoryScope,
  MemorySearchOpts,
  MemorySearchResult,
  MemorySourceType,
  MemoryExtractionMethod,
  MemoryStatus,
  MemoryWriteOpts,
  StateCheckpoint,
  StateCheckpointOpts,
} from "@db0-ai/core";
import { cosineSimilarity, generateId, VersionConflictError } from "@db0-ai/core";
import { ftsScore, rrfMerge } from "@db0-ai/core";
import createDebug from "debug";

const log = createDebug("db0:sqlite");
import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { CREATE_TABLES, SCHEMA_VERSION } from "./schema.js";

export interface SqliteBackendOptions {
  /** Path to SQLite file. Omit or use ":memory:" for in-memory database. */
  dbPath?: string;
  /** Optional URL to sql.js WASM binary for bundler environments. */
  wasmUrl?: string;
}

export class SqliteBackend implements Db0Backend {
  private db: Database;
  private dbPath: string | undefined;
  private sqlModule: ReturnType<typeof initSqlJs> extends Promise<infer T> ? T : never;
  private lastMtimeMs: number = 0;

  /** Use createSqliteBackend() factory instead. */
  constructor(db: Database, dbPath?: string, sqlModule?: any) {
    this.db = db;
    this.dbPath = dbPath;
    this.sqlModule = sqlModule;
    if (dbPath && dbPath !== ":memory:" && existsSync(dbPath)) {
      try { this.lastMtimeMs = statSync(dbPath).mtimeMs; } catch {}
    }
  }

  /**
   * Check if the on-disk DB has been modified externally and reload if so.
   * This makes the backend work correctly when another process (e.g. the
   * OpenClaw gateway) writes to the same SQLite file.
   */
  private reloadIfChanged(): void {
    if (!this.dbPath || this.dbPath === ":memory:" || !this.sqlModule) return;
    try {
      if (!existsSync(this.dbPath)) return;
      const mtime = statSync(this.dbPath).mtimeMs;
      if (mtime > this.lastMtimeMs) {
        const buffer = readFileSync(this.dbPath);
        this.db = new this.sqlModule.Database(buffer);
        this.lastMtimeMs = mtime;
        log("reloaded DB from disk (mtime changed)");
      }
    } catch (err) {
      log("reloadIfChanged failed: %O", err);
    }
  }

  /** Run a SQL statement, sanitizing params (undefined → null for sql.js) */
  private run(sql: string, params?: unknown[]): void {
    this.db.run(sql, params?.map((p) => (p === undefined ? null : p)));
  }

  /** Execute a SQL query, sanitizing params (undefined → null for sql.js) */
  private exec(sql: string, params?: unknown[]) {
    return this.db.exec(sql, params?.map((p) => (p === undefined ? null : p)));
  }

  /** Update mtime after writes so we don't reload our own changes. */
  private updateMtime(): void {
    if (!this.dbPath || this.dbPath === ":memory:") return;
    try { this.lastMtimeMs = statSync(this.dbPath).mtimeMs; } catch {}
  }

  /** Flush the database to disk (if a dbPath was provided). */
  private persist(): void {
    if (!this.dbPath) return;
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true });
      const data = (this.db as any).export() as Uint8Array;
      writeFileSync(this.dbPath, Buffer.from(data));
      this.updateMtime();
    } catch (err) {
      // Best-effort persistence — don't crash on write failures
      log("[db0] persist() failed: %O", err);
    }
  }

  // === Memory ===

  async memoryWrite(
    agentId: string,
    sessionId: string | null,
    userId: string | null,
    opts: MemoryWriteOpts,
  ): Promise<MemoryEntry> {
    const id = generateId();
    const now = new Date().toISOString();
    const embeddingBuf = Buffer.from(opts.embedding.buffer, opts.embedding.byteOffset, opts.embedding.byteLength);
    const contentStr = typeof opts.content === "string"
      ? opts.content
      : JSON.stringify(opts.content);

    // If superseding, check version and mark old memory
    let newVersion = 1;
    if (opts.supersedes) {
      const old = await this.memoryGet(opts.supersedes);
      if (old) {
        if (opts.expectedVersion !== undefined && old.version !== opts.expectedVersion) {
          throw new VersionConflictError(opts.supersedes, opts.expectedVersion, old.version);
        }
        if (old.status !== "active") {
          // Already superseded by someone else
          throw new VersionConflictError(opts.supersedes, opts.expectedVersion ?? old.version, old.version);
        }
        newVersion = old.version + 1;
        this.run(
          `UPDATE db0_memory SET status = 'superseded', valid_to = ? WHERE id = ? AND status = 'active'`,
          [now, opts.supersedes],
        );
      }
    }

    this.run(
      `INSERT INTO db0_memory (id, agent_id, session_id, user_id, content, summary, scope, embedding, tags, metadata, created_at, access_count, supersedes_id, status, version, source_type, extraction_method, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?, ?)`,
      [
        id,
        agentId ?? "",
        sessionId ?? null,
        userId ?? null,
        contentStr,
        opts.summary ?? null,
        opts.scope ?? "session",
        embeddingBuf as unknown as string,
        JSON.stringify(opts.tags ?? []),
        JSON.stringify(opts.metadata ?? {}),
        now,
        opts.supersedes ?? null,
        newVersion,
        opts.sourceType ?? null,
        opts.extractionMethod ?? null,
        opts.confidence ?? null,
      ],
    );

    // Auto-create supersedes edge
    if (opts.supersedes) {
      const edgeId = generateId();
      this.run(
        `INSERT INTO db0_memory_edges (id, source_id, target_id, edge_type, metadata, created_at)
         VALUES (?, ?, ?, 'supersedes', '{}', ?)`,
        [edgeId, id, opts.supersedes, now],
      );
    }

    this.persist();

    return {
      id,
      agentId,
      sessionId,
      userId,
      content: opts.content,
      summary: opts.summary ?? null,
      scope: opts.scope,
      embedding: opts.embedding,
      tags: opts.tags ?? [],
      metadata: opts.metadata ?? {},
      createdAt: now,
      accessCount: 0,
      supersedes: opts.supersedes ?? null,
      status: "active",
      version: newVersion,
      sourceType: opts.sourceType ?? null,
      extractionMethod: opts.extractionMethod ?? null,
      confidence: opts.confidence ?? null,
      validTo: null,
    };
  }

  async memorySearch(
    agentId: string,
    sessionId: string | null,
    userId: string | null,
    opts: MemorySearchOpts,
  ): Promise<MemorySearchResult[]> {
    this.reloadIfChanged();
    const scopes = opts.scope
      ? Array.isArray(opts.scope)
        ? opts.scope
        : [opts.scope]
      : ["task", "session", "user", "agent"];

    const limit = opts.limit ?? 10;
    const minScore = opts.minScore ?? 0;
    const scoring = opts.scoring ?? "similarity";
    const includeSuperseded = opts.includeSuperseded ?? false;

    // Build WHERE clause
    const conditions: string[] = [`agent_id = ?`];
    const params: (string | null)[] = [agentId ?? ""];

    // Status filter
    if (!includeSuperseded) {
      conditions.push(`status = 'active'`);
    }

    // Scope filter
    const scopeClauses: string[] = [];
    for (const scope of scopes) {
      if (scope === "task" || scope === "session") {
        scopeClauses.push(`(scope = '${scope}' AND session_id = ?)`);
        params.push(sessionId ?? null);
      } else if (scope === "user") {
        if (userId) {
          scopeClauses.push(`(scope = 'user' AND user_id = ?)`);
          params.push(userId);
        } else {
          // Anonymous user bucket: only include user-scoped memories with NULL user_id.
          scopeClauses.push(`(scope = 'user' AND user_id IS NULL)`);
        }
      } else if (scope === "agent") {
        scopeClauses.push(`(scope = 'agent')`);
      }
    }
    if (scopeClauses.length > 0) {
      conditions.push(`(${scopeClauses.join(" OR ")})`);
    }

    // Tag filter
    if (opts.tags && opts.tags.length > 0) {
      for (const tag of opts.tags) {
        conditions.push(`instr(tags, ?) > 0`);
        params.push(`"${tag}"`);
      }
    }

    // Since filter
    if (opts.since) {
      conditions.push(`created_at >= ?`);
      params.push(opts.since);
    }

    // Until filter
    if (opts.until) {
      conditions.push(`created_at <= ?`);
      params.push(opts.until);
    }

    const sql = `SELECT * FROM db0_memory WHERE ${conditions.join(" AND ")}`;
    const results = this.exec(sql, params as unknown[]);
    if (!results.length || !results[0].values.length) return [];

    const cols = results[0].columns;
    const now = Date.now();

    // Parse all rows into entries
    type ParsedRow = {
      entry: MemorySearchResult;
      embedding: Float32Array;
      contentStr: string;
    };
    const rows: ParsedRow[] = [];

    for (const row of results[0].values) {
      const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as Record<string, unknown>;

      // Metadata filter
      if (opts.metadata) {
        const entryMeta = JSON.parse(obj.metadata as string) as Record<string, unknown>;
        let match = true;
        for (const [key, value] of Object.entries(opts.metadata)) {
          if (entryMeta[key] !== value) { match = false; break; }
        }
        if (!match) continue;
      }

      const embeddingBlob = obj.embedding as Uint8Array;
      const embedding = new Float32Array(
        embeddingBlob.buffer,
        embeddingBlob.byteOffset,
        embeddingBlob.byteLength / 4,
      );

      rows.push({
        entry: {
          id: obj.id as string,
          agentId: obj.agent_id as string,
          sessionId: (obj.session_id as string) ?? null,
          userId: (obj.user_id as string) ?? null,
          content: this.parseContent(obj.content as string),
          summary: (obj.summary as string) ?? null,
          scope: obj.scope as MemoryScope,
          embedding,
          tags: JSON.parse(obj.tags as string) as string[],
          metadata: JSON.parse(obj.metadata as string) as Record<string, unknown>,
          createdAt: obj.created_at as string,
          accessCount: obj.access_count as number,
          supersedes: (obj.supersedes_id as string) ?? null,
          status: (obj.status as MemoryStatus) ?? "active",
          version: (obj.version as number) ?? 1,
          sourceType: (obj.source_type as MemorySourceType) ?? null,
          extractionMethod: (obj.extraction_method as MemoryExtractionMethod) ?? null,
          confidence: (obj.confidence as number) ?? null,
          validTo: (obj.valid_to as string) ?? null,
          score: 0,
        },
        embedding,
        contentStr: obj.content as string,
      });
    }

    let candidates: MemorySearchResult[];

    if (scoring === "rrf" && opts.embedding && opts.queryText) {
      // RRF: merge vector and FTS ranked lists
      // Vector ranking
      const vectorRanked = rows
        .map((r) => ({ ...r, sim: cosineSimilarity(opts.embedding!, r.embedding) }))
        .sort((a, b) => b.sim - a.sim);

      // FTS ranking
      const ftsRanked = rows
        .map((r) => ({ ...r, fts: ftsScore(r.contentStr, opts.queryText!) }))
        .filter((r) => r.fts > 0)
        .sort((a, b) => b.fts - a.fts);

      // RRF merge — use base ParsedRow type for getId
      const rrfScores = rrfMerge<ParsedRow>(
        [vectorRanked, ftsRanked],
        (item) => item.entry.id,
      );

      const rowMap = new Map(rows.map((r) => [r.entry.id, r]));
      const simMap = new Map(vectorRanked.map((r) => [r.entry.id, r.sim]));
      const ftsMap = new Map(ftsRanked.map((r) => [r.entry.id, r.fts]));

      candidates = [];
      for (const [id, score] of rrfScores) {
        if (score < minScore) continue;
        const r = rowMap.get(id)!;
        candidates.push({
          ...r.entry,
          score,
          similarityScore: simMap.get(id),
          ftsScore: ftsMap.get(id),
        });
      }
    } else if (scoring === "hybrid") {
      const wSim = opts.hybridWeights?.similarity ?? 0.7;
      const wRec = opts.hybridWeights?.recency ?? 0.2;
      const wPop = opts.hybridWeights?.popularity ?? 0.1;
      const halfLifeMs = (opts.decayHalfLifeDays ?? 7) * 24 * 60 * 60 * 1000;

      candidates = rows.map((r) => {
        const similarityScore = opts.embedding
          ? cosineSimilarity(opts.embedding, r.embedding)
          : 0;

        const createdMs = new Date(r.entry.createdAt).getTime();
        const ageMs = now - createdMs;
        const recencyScore = Math.exp(-0.693 * ageMs / halfLifeMs);

        const popularityScore = Math.min(1, Math.log2(r.entry.accessCount + 1) / 10);

        const score = similarityScore * wSim + recencyScore * wRec + popularityScore * wPop;

        return {
          ...r.entry,
          score,
          similarityScore,
          recencyScore,
          popularityScore,
        };
      }).filter((c) => c.score >= minScore);
    } else {
      // "similarity" mode (default) — or FTS-only, or embedding-only
      candidates = rows.map((r) => {
        let score: number;
        let similarityScore: number | undefined;
        let fts: number | undefined;

        if (opts.embedding) {
          const sim = cosineSimilarity(opts.embedding, r.embedding);
          similarityScore = sim;
          score = sim;
        } else if (opts.queryText) {
          const f = ftsScore(r.contentStr, opts.queryText);
          fts = f;
          score = f;
        } else {
          score = 1; // filter-only
        }

        return {
          ...r.entry,
          score,
          similarityScore,
          ftsScore: fts,
        };
      }).filter((c) => c.score >= minScore);
    }

    // Sort by score descending and take limit
    candidates.sort((a, b) => b.score - a.score);
    const topResults = candidates.slice(0, limit);

    // Increment access_count
    for (const r of topResults) {
      this.run(
        `UPDATE db0_memory SET access_count = access_count + 1 WHERE id = ?`,
        [r.id],
      );
      r.accessCount += 1;
    }

    return topResults;
  }

  async memoryList(
    agentId: string,
    scope?: MemoryScope,
  ): Promise<MemoryEntry[]> {
    this.reloadIfChanged();
    let sql = `SELECT * FROM db0_memory WHERE agent_id = ?`;
    const params: (string | null)[] = [agentId ?? ""];

    if (scope) {
      sql += ` AND scope = ?`;
      params.push(scope);
    }

    sql += ` ORDER BY created_at DESC`;

    const results = this.exec(sql, params as unknown[]);
    if (!results.length) return [];

    return this.rowsToMemoryEntries(results[0].columns, results[0].values);
  }

  async memoryGet(id: string): Promise<MemoryEntry | null> {
    this.reloadIfChanged();
    const results = this.exec(
      `SELECT * FROM db0_memory WHERE id = ?`,
      [id],
    );
    if (!results.length || !results[0].values.length) return null;

    const entries = this.rowsToMemoryEntries(results[0].columns, results[0].values);
    return entries[0] ?? null;
  }

  async memoryDelete(id: string): Promise<void> {
    this.run(`DELETE FROM db0_memory WHERE id = ?`, [id]);
    this.run(
      `DELETE FROM db0_memory_edges WHERE source_id = ? OR target_id = ?`,
      [id, id],
    );
    this.persist();
  }

  // === Memory Edges ===

  async memoryAddEdge(opts: MemoryEdgeWriteOpts): Promise<MemoryEdge> {
    const id = generateId();
    const now = new Date().toISOString();

    this.run(
      `INSERT INTO db0_memory_edges (id, source_id, target_id, edge_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, opts.sourceId, opts.targetId, opts.edgeType, JSON.stringify(opts.metadata ?? {}), now],
    );

    this.persist();

    return {
      id,
      sourceId: opts.sourceId,
      targetId: opts.targetId,
      edgeType: opts.edgeType,
      metadata: opts.metadata ?? {},
      createdAt: now,
    };
  }

  async memoryGetEdges(memoryId: string): Promise<MemoryEdge[]> {
    this.reloadIfChanged();
    const results = this.exec(
      `SELECT * FROM db0_memory_edges WHERE source_id = ? OR target_id = ?`,
      [memoryId, memoryId],
    );
    if (!results.length) return [];

    const cols = results[0].columns;
    return results[0].values.map((row) => {
      const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as Record<string, unknown>;
      return {
        id: obj.id as string,
        sourceId: obj.source_id as string,
        targetId: obj.target_id as string,
        edgeType: obj.edge_type as MemoryEdge["edgeType"],
        metadata: JSON.parse(obj.metadata as string) as Record<string, unknown>,
        createdAt: obj.created_at as string,
      };
    });
  }

  async memoryDeleteEdge(edgeId: string): Promise<void> {
    this.run(`DELETE FROM db0_memory_edges WHERE id = ?`, [edgeId]);
    this.persist();
  }

  // === State ===

  async stateCheckpoint(
    agentId: string,
    sessionId: string,
    opts: StateCheckpointOpts,
  ): Promise<StateCheckpoint> {
    const id = generateId();
    const now = new Date().toISOString();

    this.run(
      `INSERT INTO db0_state (id, agent_id, session_id, step, label, metadata, created_at, parent_checkpoint_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, agentId ?? "", sessionId ?? "",
        opts.step, opts.label ?? null,
        JSON.stringify(opts.metadata ?? {}),
        now, opts.parentCheckpointId ?? null,
      ],
    );

    this.persist();

    return {
      id, agentId, sessionId,
      step: opts.step,
      label: opts.label ?? null,
      metadata: opts.metadata ?? {},
      createdAt: now,
      parentCheckpointId: opts.parentCheckpointId ?? null,
    };
  }

  async stateRestore(agentId: string, sessionId: string): Promise<StateCheckpoint | null> {
    const sql = `SELECT * FROM db0_state WHERE agent_id = ? AND session_id = ? ORDER BY created_at DESC, step DESC LIMIT 1`;
    const params: (string | null)[] = [agentId ?? "", sessionId ?? ""];

    const results = this.exec(sql, params as unknown[]);
    if (!results.length || !results[0].values.length) return null;

    const cols = results[0].columns;
    const row = results[0].values[0];
    const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as Record<string, unknown>;
    return this.objToStateCheckpoint(obj);
  }

  async stateList(agentId: string, sessionId: string): Promise<StateCheckpoint[]> {
    const sql = `SELECT * FROM db0_state WHERE agent_id = ? AND session_id = ? ORDER BY created_at ASC`;
    const params: (string | null)[] = [agentId ?? "", sessionId ?? ""];

    const results = this.exec(sql, params as unknown[]);
    if (!results.length) return [];

    const cols = results[0].columns;
    return results[0].values.map((row) => {
      const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as Record<string, unknown>;
      return this.objToStateCheckpoint(obj);
    });
  }

  async stateGetCheckpoint(id: string): Promise<StateCheckpoint | null> {
    const results = this.exec(`SELECT * FROM db0_state WHERE id = ?`, [id]);
    if (!results.length || !results[0].values.length) return null;

    const cols = results[0].columns;
    const row = results[0].values[0];
    const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as Record<string, unknown>;
    return this.objToStateCheckpoint(obj);
  }

  // === Log ===

  async logAppend(agentId: string, sessionId: string, opts: LogAppendOpts): Promise<LogEntry> {
    const id = generateId();
    const now = new Date().toISOString();

    this.run(
      `INSERT INTO db0_log (id, agent_id, session_id, event, level, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, agentId ?? "", sessionId ?? "", opts.event, opts.level ?? "info", JSON.stringify(opts.data ?? {}), now],
    );

    this.persist();

    return {
      id, agentId, sessionId,
      event: opts.event,
      level: opts.level,
      data: opts.data ?? {},
      createdAt: now,
    };
  }

  async logQuery(agentId: string, sessionId?: string, limit?: number): Promise<LogEntry[]> {
    let sql = `SELECT * FROM db0_log WHERE agent_id = ?`;
    const params: (string | number | null)[] = [agentId ?? ""];

    if (sessionId) {
      sql += ` AND session_id = ?`;
      params.push(sessionId);
    }
    sql += ` ORDER BY created_at DESC`;
    if (limit) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    const results = this.exec(sql, params as unknown[]);
    if (!results.length) return [];

    const cols = results[0].columns;
    return results[0].values.map((row) => {
      const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as Record<string, unknown>;
      return {
        id: obj.id as string,
        agentId: obj.agent_id as string,
        sessionId: obj.session_id as string,
        event: obj.event as string,
        level: obj.level as string,
        data: JSON.parse(obj.data as string) as Record<string, unknown>,
        createdAt: obj.created_at as string,
      };
    });
  }

  // === Meta ===

  async metaGet(key: string): Promise<string | null> {
    const results = this.exec(
      `SELECT value FROM db0_meta WHERE key = ?`,
      [key],
    );
    if (!results.length || !results[0].values.length) return null;
    return results[0].values[0][0] as string;
  }

  async metaSet(key: string, value: string): Promise<void> {
    this.run(
      `INSERT OR REPLACE INTO db0_meta (key, value) VALUES (?, ?)`,
      [key, value],
    );
    this.persist();
  }

  // === Lifecycle ===

  close(): void {
    this.db.close();
  }

  // === Helpers ===

  private parseContent(raw: string): MemoryContent {
    if (raw.startsWith("{")) {
      try { return JSON.parse(raw) as Record<string, unknown>; } catch { return raw; }
    }
    return raw;
  }

  private objToStateCheckpoint(obj: Record<string, unknown>): StateCheckpoint {
    return {
      id: obj.id as string,
      agentId: obj.agent_id as string,
      sessionId: obj.session_id as string,
      step: obj.step as number,
      label: (obj.label as string) ?? null,
      metadata: JSON.parse(obj.metadata as string) as Record<string, unknown>,
      createdAt: obj.created_at as string,
      parentCheckpointId: (obj.parent_checkpoint_id as string) ?? null,
    };
  }

  private rowsToMemoryEntries(cols: string[], rows: unknown[][]): MemoryEntry[] {
    return rows.map((row) => {
      const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as Record<string, unknown>;
      const embeddingBlob = obj.embedding as Uint8Array;
      const embedding = new Float32Array(
        embeddingBlob.buffer, embeddingBlob.byteOffset, embeddingBlob.byteLength / 4,
      );

      return {
        id: obj.id as string,
        agentId: obj.agent_id as string,
        sessionId: (obj.session_id as string) ?? null,
        userId: (obj.user_id as string) ?? null,
        content: this.parseContent(obj.content as string),
        summary: (obj.summary as string) ?? null,
        scope: obj.scope as MemoryScope,
        embedding,
        tags: JSON.parse(obj.tags as string) as string[],
        metadata: JSON.parse(obj.metadata as string) as Record<string, unknown>,
        createdAt: obj.created_at as string,
        accessCount: obj.access_count as number,
        supersedes: (obj.supersedes_id as string) ?? null,
        status: (obj.status as MemoryStatus) ?? "active",
        version: (obj.version as number) ?? 1,
        sourceType: (obj.source_type as MemorySourceType) ?? null,
        extractionMethod: (obj.extraction_method as MemoryExtractionMethod) ?? null,
        confidence: (obj.confidence as number) ?? null,
        validTo: (obj.valid_to as string) ?? null,
      };
    });
  }
}

export async function createSqliteBackend(
  options?: SqliteBackendOptions,
): Promise<SqliteBackend> {
  const SQL = await initSqlJs(
    options?.wasmUrl ? { locateFile: () => options.wasmUrl! } : undefined,
  );

  let db: Database;

  // Load from disk if dbPath exists
  if (options?.dbPath && options.dbPath !== ":memory:") {
    try {
      if (existsSync(options.dbPath)) {
        const buffer = readFileSync(options.dbPath);
        db = new SQL.Database(buffer);
      } else {
        db = new SQL.Database();
      }
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run(CREATE_TABLES);

  // Migrations — best-effort, new databases already have all columns
  try {
    const result = db.exec("SELECT value FROM db0_meta WHERE key = 'schema_version'");
    const storedVersion = result.length > 0 ? Number(result[0].values[0][0]) : 0;
    if (storedVersion > 0) {
      const cols = db.exec("PRAGMA table_info(db0_memory)");
      const colNames = cols.length > 0 ? cols[0].values.map((r) => r[1] as string) : [];
      // v4 → v5: provenance and lifecycle columns
      if (storedVersion < 5) {
        if (!colNames.includes("source_type")) {
          db.run("ALTER TABLE db0_memory ADD COLUMN source_type TEXT");
        }
        if (!colNames.includes("extraction_method")) {
          db.run("ALTER TABLE db0_memory ADD COLUMN extraction_method TEXT");
        }
        if (!colNames.includes("valid_to")) {
          db.run("ALTER TABLE db0_memory ADD COLUMN valid_to TEXT");
        }
      }
      // v5 → v6: confidence column
      if (storedVersion < 6) {
        if (!colNames.includes("confidence")) {
          db.run("ALTER TABLE db0_memory ADD COLUMN confidence REAL");
        }
      }
    }
  } catch {
    // Best-effort migration — new databases already have the columns
  }

  db.run(
    `INSERT OR REPLACE INTO db0_meta (key, value) VALUES ('schema_version', ?)`,
    [String(SCHEMA_VERSION)],
  );

  return new SqliteBackend(db, options?.dbPath && options.dbPath !== ":memory:" ? options.dbPath : undefined, SQL);
}
