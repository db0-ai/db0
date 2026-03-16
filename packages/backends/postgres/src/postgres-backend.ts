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
import { generateId, VersionConflictError } from "@db0-ai/core";
import pg from "pg";
import pgvector from "pgvector/pg";
import { createTableStatements, SCHEMA_VERSION } from "./schema.js";

const { Pool } = pg;

export interface PostgresBackendOptions {
  /** PostgreSQL connection string. */
  connectionString: string;
  /** Embedding vector dimensions. Default: 1536 (OpenAI ada-002). */
  dimensions?: number;
  /** pg Pool options. */
  poolOptions?: pg.PoolConfig;
}

export class PostgresBackend implements Db0Backend {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  // === Memory ===

  async memoryWrite(
    agentId: string,
    sessionId: string | null,
    userId: string | null,
    opts: MemoryWriteOpts,
  ): Promise<MemoryEntry> {
    const id = generateId();
    const embedding = Array.from(opts.embedding);
    const tags = opts.tags ?? [];
    const metadata = opts.metadata ?? {};
    const contentStr = typeof opts.content === "string"
      ? opts.content
      : JSON.stringify(opts.content);

    // If superseding, check version and mark old memory
    let newVersion = 1;
    if (opts.supersedes) {
      const check = await this.pool.query(
        `SELECT version, status FROM db0_memory WHERE id = $1`,
        [opts.supersedes],
      );
      if (check.rows.length > 0) {
        const row = check.rows[0] as { version: number; status: string };
        if (opts.expectedVersion !== undefined && row.version !== opts.expectedVersion) {
          throw new VersionConflictError(opts.supersedes, opts.expectedVersion, row.version);
        }
        if (row.status !== "active") {
          throw new VersionConflictError(opts.supersedes, opts.expectedVersion ?? row.version, row.version);
        }
        newVersion = row.version + 1;
      }

      await this.pool.query(
        `UPDATE db0_memory SET status = 'superseded', valid_to = NOW() WHERE id = $1 AND status = 'active'`,
        [opts.supersedes],
      );
    }

    const result = await this.pool.query(
      `INSERT INTO db0_memory (id, agent_id, session_id, user_id, content, summary, scope, embedding, tags, metadata, access_count, supersedes_id, status, version, source_type, extraction_method, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, 0, $11, 'active', $12, $13, $14, $15)
       RETURNING created_at`,
      [
        id, agentId, sessionId, userId,
        contentStr, opts.summary ?? null, opts.scope, pgvector.toSql(embedding),
        JSON.stringify(tags), JSON.stringify(metadata),
        opts.supersedes ?? null, newVersion,
        opts.sourceType ?? null, opts.extractionMethod ?? null,
        opts.confidence ?? null,
      ],
    );

    // Auto-create supersedes edge
    if (opts.supersedes) {
      const edgeId = generateId();
      await this.pool.query(
        `INSERT INTO db0_memory_edges (id, source_id, target_id, edge_type, metadata)
         VALUES ($1, $2, $3, 'supersedes', '{}')`,
        [edgeId, id, opts.supersedes],
      );
    }

    return {
      id, agentId, sessionId, userId,
      content: opts.content,
      summary: opts.summary ?? null,
      scope: opts.scope,
      embedding: opts.embedding,
      tags, metadata,
      createdAt: result.rows[0].created_at.toISOString(),
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
    const scopes = opts.scope
      ? Array.isArray(opts.scope) ? opts.scope : [opts.scope]
      : ["task", "session", "user", "agent"];

    const limit = opts.limit ?? 10;
    const minScore = opts.minScore ?? 0;
    const scoring = opts.scoring ?? "similarity";
    const includeSuperseded = opts.includeSuperseded ?? false;

    // Build WHERE clause
    const conditions: string[] = [`agent_id = $1`];
    const params: unknown[] = [agentId];
    let paramIdx = 2;

    if (!includeSuperseded) {
      conditions.push(`status = 'active'`);
    }

    // Scope filter
    const scopeClauses: string[] = [];
    for (const scope of scopes) {
      if (scope === "task" || scope === "session") {
        scopeClauses.push(`(scope = '${scope}' AND session_id = $${paramIdx})`);
        params.push(sessionId);
        paramIdx++;
      } else if (scope === "user") {
        if (userId) {
          scopeClauses.push(`(scope = 'user' AND user_id = $${paramIdx})`);
          params.push(userId);
          paramIdx++;
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

    if (opts.tags && opts.tags.length > 0) {
      conditions.push(`tags @> $${paramIdx}::jsonb`);
      params.push(JSON.stringify(opts.tags));
      paramIdx++;
    }

    if (opts.since) {
      conditions.push(`created_at >= $${paramIdx}::timestamptz`);
      params.push(opts.since);
      paramIdx++;
    }

    if (opts.until) {
      conditions.push(`created_at <= $${paramIdx}::timestamptz`);
      params.push(opts.until);
      paramIdx++;
    }

    if (opts.metadata) {
      conditions.push(`metadata @> $${paramIdx}::jsonb`);
      params.push(JSON.stringify(opts.metadata));
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");
    let sql: string;

    if (scoring === "rrf" && opts.embedding && opts.queryText) {
      // RRF: two CTEs — vector search + FTS — merged with reciprocal rank fusion
      const embP = `$${paramIdx}`;
      params.push(pgvector.toSql(Array.from(opts.embedding)));
      paramIdx++;

      const queryP = `$${paramIdx}`;
      params.push(opts.queryText);
      paramIdx++;

      const limitP = `$${paramIdx}`;
      params.push(limit * 3); // fetch more candidates for RRF merge

      sql = `
        WITH vector_results AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${embP}) as vrank,
            1 - (embedding <=> ${embP}) AS similarity_score
          FROM db0_memory
          WHERE ${whereClause}
          ORDER BY embedding <=> ${embP}
          LIMIT ${limitP}
        ),
        fts_results AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(content_tsv, plainto_tsquery('english', ${queryP})) DESC) as ftsrank,
            ts_rank(content_tsv, plainto_tsquery('english', ${queryP})) AS fts_score
          FROM db0_memory
          WHERE ${whereClause}
            AND content_tsv @@ plainto_tsquery('english', ${queryP})
          LIMIT ${limitP}
        ),
        merged AS (
          SELECT
            COALESCE(v.id, f.id) AS id,
            COALESCE(1.0 / (60 + v.vrank), 0) + COALESCE(1.0 / (60 + f.ftsrank), 0) AS score,
            v.similarity_score,
            f.fts_score
          FROM vector_results v
          FULL OUTER JOIN fts_results f ON v.id = f.id
        )
        SELECT m.*, merged.score, merged.similarity_score, merged.fts_score
        FROM merged
        JOIN db0_memory m ON m.id = merged.id
        WHERE merged.score >= ${minScore}
        ORDER BY merged.score DESC
        LIMIT ${limit}
      `;
    } else if (scoring === "hybrid" && opts.embedding) {
      const wSim = opts.hybridWeights?.similarity ?? 0.7;
      const wRec = opts.hybridWeights?.recency ?? 0.2;
      const wPop = opts.hybridWeights?.popularity ?? 0.1;
      const halfLifeSecs = (opts.decayHalfLifeDays ?? 7) * 86400;

      const embP = `$${paramIdx}`;
      params.push(pgvector.toSql(Array.from(opts.embedding)));
      paramIdx++;

      const limitP = `$${paramIdx}`;
      params.push(limit);

      sql = `
        SELECT *,
          1 - (embedding <=> ${embP}) AS similarity_score,
          EXP(-0.693 * EXTRACT(EPOCH FROM (NOW() - created_at)) / ${halfLifeSecs}) AS recency_score,
          LEAST(1.0, LOG(2, access_count + 1) / 10) AS popularity_score,
          (1 - (embedding <=> ${embP})) * ${wSim}
            + EXP(-0.693 * EXTRACT(EPOCH FROM (NOW() - created_at)) / ${halfLifeSecs}) * ${wRec}
            + LEAST(1.0, LOG(2, access_count + 1) / 10) * ${wPop}
          AS score
        FROM db0_memory
        WHERE ${whereClause}
          AND (1 - (embedding <=> ${embP})) * ${wSim}
            + EXP(-0.693 * EXTRACT(EPOCH FROM (NOW() - created_at)) / ${halfLifeSecs}) * ${wRec}
            + LEAST(1.0, LOG(2, access_count + 1) / 10) * ${wPop}
            >= ${minScore}
        ORDER BY score DESC
        LIMIT ${limitP}
      `;
    } else if (opts.embedding) {
      // Pure similarity
      const embP = `$${paramIdx}`;
      params.push(pgvector.toSql(Array.from(opts.embedding)));
      paramIdx++;

      const limitP = `$${paramIdx}`;
      params.push(limit);

      sql = `
        SELECT *, 1 - (embedding <=> ${embP}) AS score
        FROM db0_memory
        WHERE ${whereClause}
          AND 1 - (embedding <=> ${embP}) >= ${minScore}
        ORDER BY embedding <=> ${embP}
        LIMIT ${limitP}
      `;
    } else if (opts.queryText) {
      // Pure FTS
      const queryP = `$${paramIdx}`;
      params.push(opts.queryText);
      paramIdx++;

      const limitP = `$${paramIdx}`;
      params.push(limit);

      sql = `
        SELECT *,
          ts_rank(content_tsv, plainto_tsquery('english', ${queryP})) AS score,
          ts_rank(content_tsv, plainto_tsquery('english', ${queryP})) AS fts_score
        FROM db0_memory
        WHERE ${whereClause}
          AND content_tsv @@ plainto_tsquery('english', ${queryP})
        ORDER BY score DESC
        LIMIT ${limitP}
      `;
    } else {
      // Filter-only
      const limitP = `$${paramIdx}`;
      params.push(limit);

      sql = `
        SELECT *, 1.0 AS score
        FROM db0_memory
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limitP}
      `;
    }

    const result = await this.pool.query(sql, params);

    // Increment access_count
    if (result.rows.length > 0) {
      const ids = result.rows.map((r: Record<string, unknown>) => r.id as string);
      await this.pool.query(
        `UPDATE db0_memory SET access_count = access_count + 1 WHERE id = ANY($1)`,
        [ids],
      );
    }

    return result.rows.map((row: Record<string, unknown>) => {
      const entry = this.rowToMemoryEntry(row);
      return {
        ...entry,
        accessCount: entry.accessCount + 1,
        score: row.score as number,
        similarityScore: row.similarity_score as number | undefined,
        recencyScore: row.recency_score as number | undefined,
        popularityScore: row.popularity_score as number | undefined,
        ftsScore: row.fts_score as number | undefined,
      };
    });
  }

  async memoryList(agentId: string, scope?: MemoryScope): Promise<MemoryEntry[]> {
    let sql = `SELECT * FROM db0_memory WHERE agent_id = $1`;
    const params: string[] = [agentId];

    if (scope) {
      sql += ` AND scope = $2`;
      params.push(scope);
    }

    sql += ` ORDER BY created_at DESC`;

    const result = await this.pool.query(sql, params);
    return result.rows.map((row: Record<string, unknown>) => this.rowToMemoryEntry(row));
  }

  async memoryGet(id: string): Promise<MemoryEntry | null> {
    const result = await this.pool.query(`SELECT * FROM db0_memory WHERE id = $1`, [id]);
    if (result.rows.length === 0) return null;
    return this.rowToMemoryEntry(result.rows[0] as Record<string, unknown>);
  }

  async memoryDelete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM db0_memory WHERE id = $1`, [id]);
  }

  // === Memory Edges ===

  async memoryAddEdge(opts: MemoryEdgeWriteOpts): Promise<MemoryEdge> {
    const id = generateId();
    const metadata = opts.metadata ?? {};
    const result = await this.pool.query(
      `INSERT INTO db0_memory_edges (id, source_id, target_id, edge_type, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING created_at`,
      [id, opts.sourceId, opts.targetId, opts.edgeType, JSON.stringify(metadata)],
    );
    return {
      id, sourceId: opts.sourceId, targetId: opts.targetId,
      edgeType: opts.edgeType, metadata,
      createdAt: result.rows[0].created_at.toISOString(),
    };
  }

  async memoryGetEdges(memoryId: string): Promise<MemoryEdge[]> {
    const result = await this.pool.query(
      `SELECT * FROM db0_memory_edges WHERE source_id = $1 OR target_id = $1`,
      [memoryId],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      edgeType: row.edge_type as MemoryEdge["edgeType"],
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string),
    }));
  }

  async memoryDeleteEdge(edgeId: string): Promise<void> {
    await this.pool.query(`DELETE FROM db0_memory_edges WHERE id = $1`, [edgeId]);
  }

  // === State ===

  async stateCheckpoint(agentId: string, sessionId: string, opts: StateCheckpointOpts): Promise<StateCheckpoint> {
    const id = generateId();
    const metadata = opts.metadata ?? {};
    const result = await this.pool.query(
      `INSERT INTO db0_state (id, agent_id, session_id, step, label, metadata, parent_checkpoint_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING created_at`,
      [id, agentId, sessionId, opts.step, opts.label ?? null, JSON.stringify(metadata), opts.parentCheckpointId ?? null],
    );
    return {
      id, agentId, sessionId,
      step: opts.step, label: opts.label ?? null, metadata,
      createdAt: result.rows[0].created_at.toISOString(),
      parentCheckpointId: opts.parentCheckpointId ?? null,
    };
  }

  async stateRestore(agentId: string, sessionId: string): Promise<StateCheckpoint | null> {
    const sql = `SELECT * FROM db0_state WHERE agent_id = $1 AND session_id = $2 ORDER BY created_at DESC, step DESC LIMIT 1`;
    const params: (string | null)[] = [agentId, sessionId];

    const result = await this.pool.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.rowToStateCheckpoint(result.rows[0] as Record<string, unknown>);
  }

  async stateList(agentId: string, sessionId: string): Promise<StateCheckpoint[]> {
    const sql = `SELECT * FROM db0_state WHERE agent_id = $1 AND session_id = $2 ORDER BY created_at ASC`;
    const params: (string | null)[] = [agentId, sessionId];

    const result = await this.pool.query(sql, params);
    return result.rows.map((row: Record<string, unknown>) => this.rowToStateCheckpoint(row));
  }

  async stateGetCheckpoint(id: string): Promise<StateCheckpoint | null> {
    const result = await this.pool.query(`SELECT * FROM db0_state WHERE id = $1`, [id]);
    if (result.rows.length === 0) return null;
    return this.rowToStateCheckpoint(result.rows[0] as Record<string, unknown>);
  }

  // === Log ===

  async logAppend(agentId: string, sessionId: string, opts: LogAppendOpts): Promise<LogEntry> {
    const id = generateId();
    const data = opts.data ?? {};
    const result = await this.pool.query(
      `INSERT INTO db0_log (id, agent_id, session_id, event, level, data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING created_at`,
      [id, agentId, sessionId, opts.event, opts.level, JSON.stringify(data)],
    );
    return {
      id, agentId, sessionId,
      event: opts.event, level: opts.level, data,
      createdAt: result.rows[0].created_at.toISOString(),
    };
  }

  async logQuery(agentId: string, sessionId?: string, limit?: number): Promise<LogEntry[]> {
    let sql = `SELECT * FROM db0_log WHERE agent_id = $1`;
    const params: (string | number | null)[] = [agentId];
    let paramIdx = 2;

    if (sessionId) {
      sql += ` AND session_id = $${paramIdx}`;
      params.push(sessionId);
      paramIdx++;
    }
    sql += ` ORDER BY created_at DESC`;
    if (limit) {
      sql += ` LIMIT $${paramIdx}`;
      params.push(limit);
    }

    const result = await this.pool.query(sql, params);
    return result.rows.map((row: Record<string, unknown>) => this.rowToLogEntry(row));
  }

  // === Meta ===

  async metaGet(key: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT value FROM db0_meta WHERE key = $1`,
      [key],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].value as string;
  }

  async metaSet(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO db0_meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value],
    );
  }

  // === Lifecycle ===
  close(): void { void this.pool.end(); }

  // === Helpers ===

  private parseContent(raw: string): MemoryContent {
    if (raw.startsWith("{")) {
      try { return JSON.parse(raw) as Record<string, unknown>; } catch { return raw; }
    }
    return raw;
  }

  private rowToMemoryEntry(row: Record<string, unknown>): MemoryEntry {
    const embedding = this.parseEmbedding(row.embedding);
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      sessionId: (row.session_id as string) ?? null,
      userId: (row.user_id as string) ?? null,
      content: this.parseContent(row.content as string),
      summary: (row.summary as string) ?? null,
      scope: row.scope as MemoryScope,
      embedding,
      tags: row.tags as string[],
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string),
      accessCount: row.access_count as number,
      supersedes: (row.supersedes_id as string) ?? null,
      status: (row.status as MemoryStatus) ?? "active",
      version: (row.version as number) ?? 1,
      sourceType: (row.source_type as MemorySourceType) ?? null,
      extractionMethod: (row.extraction_method as MemoryExtractionMethod) ?? null,
      confidence: (row.confidence as number) ?? null,
      validTo: row.valid_to instanceof Date
        ? row.valid_to.toISOString()
        : (row.valid_to as string) ?? null,
    };
  }

  private rowToStateCheckpoint(row: Record<string, unknown>): StateCheckpoint {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      sessionId: row.session_id as string,
      step: row.step as number,
      label: (row.label as string) ?? null,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string),
      parentCheckpointId: (row.parent_checkpoint_id as string) ?? null,
    };
  }

  private rowToLogEntry(row: Record<string, unknown>): LogEntry {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      sessionId: row.session_id as string,
      event: row.event as string,
      level: row.level as string,
      data: row.data as Record<string, unknown>,
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string),
    };
  }

  private parseEmbedding(value: unknown): Float32Array {
    if (typeof value === "string") {
      const nums = value.replace(/^\[/, "").replace(/\]$/, "").split(",").map(Number);
      return new Float32Array(nums);
    }
    if (Array.isArray(value)) return new Float32Array(value as number[]);
    return new Float32Array(0);
  }
}

export async function createPostgresBackend(
  options: PostgresBackendOptions,
): Promise<PostgresBackend> {
  const dimensions = options.dimensions ?? 1536;

  const pool = new Pool({
    connectionString: options.connectionString,
    ...options.poolOptions,
  });

  const client = await pool.connect();
  try {
    await pgvector.registerType(client);
    for (const stmt of createTableStatements(dimensions)) {
      await client.query(stmt);
    }
    // Migrations — best-effort, new databases already have all columns
    try {
      const versionResult = await client.query(
        "SELECT value FROM db0_meta WHERE key = 'schema_version'",
      );
      const storedVersion = versionResult.rows.length > 0 ? Number(versionResult.rows[0].value) : 0;
      if (storedVersion > 0) {
        const colResult = await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'db0_memory'",
        );
        const colNames = colResult.rows.map((r: Record<string, unknown>) => r.column_name as string);
        // v4 → v5: provenance and lifecycle columns
        if (storedVersion < 5) {
          if (!colNames.includes("source_type")) {
            await client.query("ALTER TABLE db0_memory ADD COLUMN source_type TEXT");
          }
          if (!colNames.includes("extraction_method")) {
            await client.query("ALTER TABLE db0_memory ADD COLUMN extraction_method TEXT");
          }
          if (!colNames.includes("valid_to")) {
            await client.query("ALTER TABLE db0_memory ADD COLUMN valid_to TIMESTAMPTZ");
          }
        }
        // v5 → v6: confidence column
        if (storedVersion < 6) {
          if (!colNames.includes("confidence")) {
            await client.query("ALTER TABLE db0_memory ADD COLUMN confidence REAL");
          }
        }
      }
    } catch {
      // Best-effort migration
    }

    await client.query(
      `INSERT INTO db0_meta (key, value) VALUES ('schema_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(SCHEMA_VERSION)],
    );
  } finally {
    client.release();
  }

  return new PostgresBackend(pool);
}
