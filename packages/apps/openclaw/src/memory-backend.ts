import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  defaultEmbeddingFn,
  chunkText,
  type Harness,
  type MemorySearchResult,
  type MemoryEntry,
} from "@db0-ai/core";
import { log } from "./logger.js";

// === OpenClaw MemorySearchResult shape ===

export interface OpenClawMemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory" | "sessions";
  citation?: string;
}

// === File snapshot for versioning ===

export interface FileSnapshot {
  relativePath: string;
  contentHash: string;
  lineCount: number;
  snapshotAt: string;
  /** Previous content hash before this sync, if any */
  previousHash: string | null;
}

export interface OverwriteEvent {
  relativePath: string;
  previousHash: string;
  previousLineCount: number;
  currentHash: string;
  currentLineCount: number;
  lineDelta: number;
  detectedAt: string;
}

export interface FileRollbackResult {
  ok: boolean;
  relativePath: string;
  restoredHash?: string;
  restoredAt?: string;
  reason?: string;
}

// === Config ===

export interface Db0MemoryBackendConfig {
  /** Workspace directory containing MEMORY.md and memory/ folder */
  workspaceDir: string;

  /** Parent harness to spawn from (shares backend, won't close it) */
  parentHarness: Harness;

  /** Embedding function (single text) */
  embeddingFn?: (text: string) => Promise<Float32Array>;

  /** Batch embedding function for bulk indexing. Falls back to sequential embeddingFn if not provided. */
  batchEmbeddingFn?: (texts: string[]) => Promise<Float32Array[]>;

  /** Target chunk size in characters. Default: 1600 (~400 tokens) */
  chunkSize?: number;

  /** Overlap between chunks in characters. Default: 320 (~80 tokens) */
  chunkOverlap?: number;

  /**
   * Line-count shrink threshold for destructive overwrite detection.
   * If a file loses more than this fraction of lines in a single sync,
   * it's flagged as a potential destructive overwrite. Default: 0.5 (50%)
   */
  overwriteThreshold?: number;
}

// === Sync result delta ===

export interface SyncContentDelta {
  /** Relative path of the changed file */
  relativePath: string;
  /** Full file content */
  content: string;
  /** True if this file was not previously indexed */
  isNew: boolean;
  /** Previous content hash, or null for new files */
  previousContentHash: string | null;
}

// === Types ===

interface IndexedFile {
  mtime: number;
  chunkIds: string[];
  contentHash: string;
  lineCount: number;
}

// === Implementation ===

export class Db0MemoryBackend {
  private harness: Harness;
  private workspaceDir: string;
  private embeddingFn: (text: string) => Promise<Float32Array>;
  private batchEmbeddingFn: (texts: string[]) => Promise<Float32Array[]>;
  private chunkSize: number;
  private chunkOverlap: number;
  private overwriteThreshold: number;
  private indexedFiles: Map<string, IndexedFile> = new Map();
  private fileSnapshots: Map<string, FileSnapshot> = new Map();
  private overwriteEvents: OverwriteEvent[] = [];

  constructor(config: Db0MemoryBackendConfig) {
    this.workspaceDir = config.workspaceDir;
    this.embeddingFn = config.embeddingFn ?? defaultEmbeddingFn;
    // Batch function: use provided one, or fall back to sequential single calls
    this.batchEmbeddingFn = config.batchEmbeddingFn ?? (async (texts: string[]) => {
      const results: Float32Array[] = [];
      for (const text of texts) {
        results.push(await this.embeddingFn(text));
      }
      return results;
    });
    this.chunkSize = config.chunkSize ?? 1600;
    this.chunkOverlap = config.chunkOverlap ?? 320;
    this.overwriteThreshold = config.overwriteThreshold ?? 0.5;

    // Spawn as child so we share the backend without closing it on dispose
    this.harness = config.parentHarness.spawn({
      agentId: config.parentHarness.agentId,
      sessionId: "file-index",
    });
  }

  /**
   * Sync markdown memory files into db0.
   * Indexes MEMORY.md and memory/*.md, detecting changes via mtime.
   * Tracks content hashes for overwrite detection and creates
   * relationship edges between related chunks.
   */
  async sync(): Promise<{
    indexed: number;
    removed: number;
    unchanged: number;
    overwrites: OverwriteEvent[];
    newContent: SyncContentDelta[];
  }> {
    // Hydrate indexedFiles from database on first sync — prevents duplicate
    // chunk creation when a new Db0MemoryBackend instance is created
    // (e.g. after /new or process restart). Without this, every bootstrap
    // creates fresh duplicate file-chunk entries because the in-memory
    // indexedFiles map starts empty.
    if (this.indexedFiles.size === 0) {
      await this.hydrateIndexFromDatabase();
    }

    const files = this.discoverFiles();
    const currentPaths = new Set(files.map((f) => f.relativePath));
    let indexed = 0;
    let removed = 0;
    let unchanged = 0;
    const newOverwrites: OverwriteEvent[] = [];
    const newlyIndexedChunkIds: string[] = [];
    const newContent: SyncContentDelta[] = [];

    // Index new or changed files
    for (const file of files) {
      const existing = this.indexedFiles.get(file.relativePath);
      if (existing && existing.mtime === file.mtime) {
        unchanged++;
        continue;
      }

      const content = readFileSync(file.absolutePath, "utf-8");
      const contentHash = this.hashContent(content);
      const lineCount = content.split("\n").length;

      // Content-hash match: file is already indexed with identical content.
      // Update the mtime cache so subsequent syncs skip the file read.
      if (existing && existing.contentHash === contentHash) {
        this.indexedFiles.set(file.relativePath, { ...existing, mtime: file.mtime, lineCount });
        unchanged++;
        continue;
      }

      // Check for destructive overwrite
      if (existing && existing.contentHash !== contentHash) {
        const lineDelta = lineCount - existing.lineCount;
        const shrinkFraction = existing.lineCount > 0
          ? (existing.lineCount - lineCount) / existing.lineCount
          : 0;

        if (shrinkFraction > this.overwriteThreshold) {
          const event: OverwriteEvent = {
            relativePath: file.relativePath,
            previousHash: existing.contentHash,
            previousLineCount: existing.lineCount,
            currentHash: contentHash,
            currentLineCount: lineCount,
            lineDelta,
            detectedAt: new Date().toISOString(),
          };
          newOverwrites.push(event);
          this.overwriteEvents.push(event);

          // Log the destructive overwrite
          await this.harness.log().append({
            event: "memory.overwrite-detected",
            level: "warn",
            data: event as unknown as Record<string, unknown>,
          });
        }
      }

      // Update snapshot
      const previousSnapshot = this.fileSnapshots.get(file.relativePath);
      this.fileSnapshots.set(file.relativePath, {
        relativePath: file.relativePath,
        contentHash,
        lineCount,
        snapshotAt: new Date().toISOString(),
        previousHash: previousSnapshot?.contentHash ?? null,
      });

      // Track new/changed content for tier-1 promotion
      newContent.push({
        relativePath: file.relativePath,
        content,
        isNew: !existing,
        previousContentHash: existing?.contentHash ?? null,
      });

      // Remove old chunks if re-indexing
      if (existing) {
        await this.removeChunks(existing.chunkIds);
      }

      const chunkIds = await this.indexFileContent(
        content,
        file.relativePath,
        contentHash,
      );
      this.indexedFiles.set(file.relativePath, {
        mtime: file.mtime,
        chunkIds,
        contentHash,
        lineCount,
      });
      newlyIndexedChunkIds.push(...chunkIds);
      indexed++;
    }

    // Remove chunks for deleted files
    for (const [path, entry] of this.indexedFiles) {
      if (!currentPaths.has(path)) {
        await this.removeChunks(entry.chunkIds);
        this.indexedFiles.delete(path);
        this.fileSnapshots.delete(path);
        removed++;
      }
    }

    // Detect relationships between newly indexed chunks
    if (newlyIndexedChunkIds.length > 0) {
      await this.detectRelationships(newlyIndexedChunkIds);
    }

    return { indexed, removed, unchanged, overwrites: newOverwrites, newContent };
  }

  /**
   * Snapshot all memory files right now — used before compaction
   * to preserve state in case compaction overwrites files.
   */
  async snapshotFiles(): Promise<FileSnapshot[]> {
    const files = this.discoverFiles();
    const snapshots: FileSnapshot[] = [];

    for (const file of files) {
      const content = readFileSync(file.absolutePath, "utf-8");
      const contentHash = this.hashContent(content);
      const lineCount = content.split("\n").length;
      const previousSnapshot = this.fileSnapshots.get(file.relativePath);

      const snapshot: FileSnapshot = {
        relativePath: file.relativePath,
        contentHash,
        lineCount,
        snapshotAt: new Date().toISOString(),
        previousHash: previousSnapshot?.contentHash ?? null,
      };

      this.fileSnapshots.set(file.relativePath, snapshot);
      snapshots.push(snapshot);

      // Store the full content as a versioned memory entry.
      // Snapshots use "agent" scope intentionally (Issue 6): these are
      // operational rollback data, not user-facing knowledge. They should
      // not appear in user-facing memory_search results.
      if (content.trim()) {
        const embedding = await this.embeddingFn(
          content.slice(0, this.chunkSize),
        );
        await this.harness.memory().write({
          content,
          scope: "agent",
          embedding,
          tags: ["file-snapshot", `source:${file.relativePath}`],
          metadata: {
            filePath: file.relativePath,
            contentHash,
            lineCount,
            snapshotAt: snapshot.snapshotAt,
            snapshotReason: "pre-compaction",
          },
        });
      }
    }

    return snapshots;
  }

  /**
   * Snapshot files that have changed since their last snapshot.
   * Unlike snapshotFiles() (which snapshots everything unconditionally),
   * this skips files whose content hash matches the latest stored snapshot.
   * Used for background backup during bootstrap — lightweight and incremental.
   */
  async snapshotChanged(reason = "background-backup"): Promise<{
    snapshotted: number;
    unchanged: number;
  }> {
    const files = this.discoverFiles();
    let snapshotted = 0;
    let unchanged = 0;

    // Get existing snapshot hashes from backend to avoid redundant writes
    const existingSnapshots = await this.listSnapshots();
    const latestHashes = new Map(
      existingSnapshots.map((s) => [s.relativePath, s.latestHash]),
    );

    for (const file of files) {
      const content = readFileSync(file.absolutePath, "utf-8");
      if (!content.trim()) continue;

      const contentHash = this.hashContent(content);

      // Skip if the latest snapshot in the backend already has this exact content
      if (latestHashes.get(file.relativePath) === contentHash) {
        unchanged++;
        continue;
      }

      const lineCount = content.split("\n").length;
      const previousSnapshot = this.fileSnapshots.get(file.relativePath);

      this.fileSnapshots.set(file.relativePath, {
        relativePath: file.relativePath,
        contentHash,
        lineCount,
        snapshotAt: new Date().toISOString(),
        previousHash: previousSnapshot?.contentHash ?? null,
      });

      // "agent" scope — operational rollback data, not user-facing (see Issue 6)
      const embedding = await this.embeddingFn(
        content.slice(0, this.chunkSize),
      );
      await this.harness.memory().write({
        content,
        scope: "agent",
        embedding,
        tags: ["file-snapshot", `source:${file.relativePath}`],
        metadata: {
          filePath: file.relativePath,
          contentHash,
          lineCount,
          snapshotAt: new Date().toISOString(),
          snapshotReason: reason,
        },
      });
      snapshotted++;
    }

    return { snapshotted, unchanged };
  }

  /**
   * Get all detected destructive overwrite events.
   */
  getOverwriteEvents(): OverwriteEvent[] {
    return [...this.overwriteEvents];
  }

  /**
   * Get the current snapshot for a file.
   */
  getFileSnapshot(relativePath: string): FileSnapshot | undefined {
    return this.fileSnapshots.get(relativePath);
  }

  /**
   * Restore a memory file from stored snapshots in db0.
   * If contentHash is omitted, restores the newest available snapshot.
   */
  async rollbackFile(params: {
    relPath: string;
    contentHash?: string;
  }): Promise<FileRollbackResult> {
    const relPath = params.relPath.replace(/\.\./g, "");
    const absPath = resolve(this.workspaceDir, relPath);
    if (!absPath.startsWith(resolve(this.workspaceDir))) {
      return { ok: false, relativePath: relPath, reason: "path outside workspace" };
    }

    const probeEmbedding = await this.embeddingFn(relPath);
    const candidates = await this.harness.memory().search({
      embedding: probeEmbedding,
      scope: ["agent"],
      tags: ["file-snapshot", `source:${relPath}`],
      metadata: {
        filePath: relPath,
        snapshotReason: "pre-compaction",
      },
      limit: 50,
      minScore: 0,
      includeSuperseded: true,
    });

    if (candidates.length === 0) {
      return { ok: false, relativePath: relPath, reason: "no snapshots found" };
    }

    const target = params.contentHash
      ? candidates.find((c) => (c.metadata?.contentHash as string | undefined) === params.contentHash)
      : candidates
        .slice()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

    if (!target) {
      return { ok: false, relativePath: relPath, reason: "requested snapshot hash not found" };
    }

    const content = typeof target.content === "string"
      ? target.content
      : JSON.stringify(target.content, null, 2);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    await this.sync();

    const restoredHash = (target.metadata?.contentHash as string | undefined) ?? this.hashContent(content);
    const restoredAt = new Date().toISOString();
    await this.harness.log().append({
      event: "memory.rollback",
      level: "warn",
      data: {
        relativePath: relPath,
        restoredHash,
        restoredAt,
      },
    });

    return {
      ok: true,
      relativePath: relPath,
      restoredHash,
      restoredAt,
    };
  }

  /**
   * List all available file snapshots stored in the backend.
   * Groups by file path and returns the latest snapshot per file,
   * plus total snapshot count per file for version awareness.
   */
  async listSnapshots(): Promise<Array<{
    relativePath: string;
    latestHash: string;
    latestAt: string;
    lineCount: number;
    snapshotCount: number;
  }>> {
    const all = await this.harness.memory().list("agent");
    const snapshots = all.filter(
      (m) => m.status === "active" && m.tags.includes("file-snapshot"),
    );

    // Group by file path
    const grouped = new Map<string, MemoryEntry[]>();
    for (const snap of snapshots) {
      const filePath = (snap.metadata?.filePath as string) ?? "";
      if (!filePath) continue;
      const group = grouped.get(filePath) ?? [];
      group.push(snap);
      grouped.set(filePath, group);
    }

    const results: Array<{
      relativePath: string;
      latestHash: string;
      latestAt: string;
      lineCount: number;
      snapshotCount: number;
    }> = [];

    for (const [filePath, entries] of grouped) {
      // Sort by creation time descending to find latest
      entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const latest = entries[0];
      results.push({
        relativePath: filePath,
        latestHash: (latest.metadata?.contentHash as string) ?? "",
        latestAt: (latest.metadata?.snapshotAt as string) ?? latest.createdAt,
        lineCount: (latest.metadata?.lineCount as number) ?? 0,
        snapshotCount: entries.length,
      });
    }

    // Sort by path for consistent display
    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return results;
  }

  /**
   * Restore workspace files from backend snapshots.
   * Used for disaster recovery when local files are lost but the backend (e.g. hosted PG) survives.
   *
   * @param filePaths - specific files to restore, or undefined to restore all available
   * @returns summary of restored files
   */
  async restoreWorkspace(filePaths?: string[]): Promise<{
    restored: Array<{ relativePath: string; hash: string; lines: number }>;
    skipped: Array<{ relativePath: string; reason: string }>;
    failed: Array<{ relativePath: string; error: string }>;
  }> {
    const restored: Array<{ relativePath: string; hash: string; lines: number }> = [];
    const skipped: Array<{ relativePath: string; reason: string }> = [];
    const failed: Array<{ relativePath: string; error: string }> = [];

    const available = await this.listSnapshots();
    const toRestore = filePaths
      ? available.filter((s) => filePaths.includes(s.relativePath))
      : available;

    if (filePaths) {
      // Report any requested files that have no snapshots
      for (const fp of filePaths) {
        if (!available.some((s) => s.relativePath === fp)) {
          failed.push({ relativePath: fp, error: "no snapshots found in backend" });
        }
      }
    }

    for (const snap of toRestore) {
      const absPath = resolve(this.workspaceDir, snap.relativePath);
      // Safety check
      if (!absPath.startsWith(resolve(this.workspaceDir))) {
        skipped.push({ relativePath: snap.relativePath, reason: "path outside workspace" });
        continue;
      }

      // Skip if local file already exists and is non-empty
      if (existsSync(absPath)) {
        const existing = readFileSync(absPath, "utf-8");
        if (existing.trim().length > 0) {
          skipped.push({ relativePath: snap.relativePath, reason: "file already exists locally" });
          continue;
        }
      }

      try {
        const result = await this.rollbackFile({ relPath: snap.relativePath });
        if (result.ok) {
          restored.push({
            relativePath: snap.relativePath,
            hash: result.restoredHash ?? snap.latestHash,
            lines: snap.lineCount,
          });
        } else {
          failed.push({ relativePath: snap.relativePath, error: result.reason ?? "unknown" });
        }
      } catch (err) {
        failed.push({
          relativePath: snap.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { restored, skipped, failed };
  }

  getIntegrityReport(): {
    indexedFiles: number;
    overwriteEvents: number;
    lastOverwriteAt: string | null;
    fileSnapshots: number;
  } {
    const last = this.overwriteEvents.length > 0
      ? this.overwriteEvents[this.overwriteEvents.length - 1].detectedAt
      : null;
    return {
      indexedFiles: this.indexedFiles.size,
      overwriteEvents: this.overwriteEvents.length,
      lastOverwriteAt: last,
      fileSnapshots: this.fileSnapshots.size,
    };
  }

  /**
   * Search indexed memory files using semantic similarity.
   */
  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number },
  ): Promise<OpenClawMemorySearchResult[]> {
    const embedding = await this.embeddingFn(query);
    const limit = opts?.maxResults ?? 8;
    const minScore = opts?.minScore ?? 0.3;

    // Search both user and agent scopes — file chunks are stored in "user" scope
    // but snapshots and promoted content may live in "agent" scope. Including both
    // ensures retrieval covers the full indexed surface.
    const results = await this.harness.memory().search({
      embedding,
      scope: ["user", "agent"],
      limit: limit * 3, // Over-fetch to allow for dedup
      minScore,
      tags: ["file-chunk"],
    });

    // Deduplicate by content — legacy databases may have duplicate chunks
    // from repeated sync() calls without hydration.
    const seen = new Set<string>();
    const deduped: MemorySearchResult[] = [];
    for (const r of results) {
      const key = typeof r.content === "string" ? r.content.slice(0, 200) : JSON.stringify(r.content).slice(0, 200);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
      if (deduped.length >= limit) break;
    }

    return deduped.map((r) => this.toOpenClawResult(r));
  }

  /**
   * Read a memory file by relative path.
   */
  readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): { text: string; path: string } {
    const normalized = params.relPath.replace(/\.\./g, "");
    const absPath = resolve(this.workspaceDir, normalized);

    // Security: ensure path is within workspace
    if (!absPath.startsWith(resolve(this.workspaceDir))) {
      return { text: "", path: params.relPath };
    }

    if (!existsSync(absPath)) {
      return { text: "", path: params.relPath };
    }

    const content = readFileSync(absPath, "utf-8");
    const allLines = content.split("\n");

    if (params.from !== undefined || params.lines !== undefined) {
      const start = (params.from ?? 1) - 1; // 1-indexed to 0-indexed
      const count = params.lines ?? allLines.length;
      return {
        text: allLines.slice(start, start + count).join("\n"),
        path: params.relPath,
      };
    }

    return { text: content, path: params.relPath };
  }

  /**
   * Dispose: close the harness.
   */
  async dispose(): Promise<void> {
    this.harness.close();
  }

  // === Private ===

  private discoverFiles(): Array<{
    absolutePath: string;
    relativePath: string;
    mtime: number;
  }> {
    const files: Array<{
      absolutePath: string;
      relativePath: string;
      mtime: number;
    }> = [];

    // Top-level markdown files: MEMORY.md, USER.md, etc.
    const topLevelFiles = ["MEMORY.md", "USER.md", "IDENTITY.md", "SOUL.md", "TOOLS.md", "BOOTSTRAP.md", "AGENTS.md", "HEARTBEAT.md"];
    for (const name of topLevelFiles) {
      const filePath = join(this.workspaceDir, name);
      if (existsSync(filePath)) {
        files.push({
          absolutePath: filePath,
          relativePath: name,
          mtime: statSync(filePath).mtimeMs,
        });
      }
    }

    // memory/*.md (non-recursive for simplicity; matches OpenClaw's pattern)
    const memoryDir = join(this.workspaceDir, "memory");
    if (existsSync(memoryDir)) {
      try {
        for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            const absPath = join(memoryDir, entry.name);
            files.push({
              absolutePath: absPath,
              relativePath: `memory/${entry.name}`,
              mtime: statSync(absPath).mtimeMs,
            });
          }
        }
      } catch {
        // If readdir fails, skip
      }
    }

    return files;
  }

  private async indexFileContent(
    content: string,
    relativePath: string,
    contentHash?: string,
  ): Promise<string[]> {
    if (!content.trim()) return [];

    const chunks = chunkText(content, {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });

    // Batch embed all chunks at once
    const embeddings = await this.batchEmbeddingFn(chunks);

    const ids: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { startLine, endLine } = this.computeLineRange(content, chunk, i);

      // File chunks are stored in "user" scope intentionally (Issue 6):
      // MEMORY.md and memory/*.md represent the user's durable knowledge base.
      // Even TOOLS.md/AGENTS.md chunks live here because the file-chunk search
      // queries both ["user", "agent"] scopes, and keeping all chunks in one
      // scope simplifies indexing. Scope metadata can be added later as a
      // non-breaking enhancement if per-file scope filtering is needed.
      const entry = await this.harness.memory().write({
        content: chunk,
        scope: "user",
        embedding: embeddings[i],
        tags: ["file-chunk", `source:${relativePath}`],
        metadata: {
          filePath: relativePath,
          chunkIndex: i,
          totalChunks: chunks.length,
          startLine,
          endLine,
          ...(contentHash ? { contentHash } : {}),
        },
      });

      ids.push(entry.id);
    }

    return ids;
  }

  private computeLineRange(
    fullText: string,
    chunk: string,
    _chunkIndex: number,
  ): { startLine: number; endLine: number } {
    // Find the chunk's position in the original text
    const offset = fullText.indexOf(chunk.slice(0, 80));
    if (offset === -1) {
      return { startLine: 1, endLine: 1 };
    }

    const beforeChunk = fullText.slice(0, offset);
    const startLine = (beforeChunk.match(/\n/g) || []).length + 1;
    const chunkLines = (chunk.match(/\n/g) || []).length;
    const endLine = startLine + chunkLines;

    return { startLine, endLine };
  }

  private async removeChunks(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.harness.memory().delete(id);
    }
  }

  private toOpenClawResult(r: MemorySearchResult): OpenClawMemorySearchResult {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const snippet =
      typeof r.content === "string"
        ? r.content.slice(0, 700)
        : JSON.stringify(r.content).slice(0, 700);

    return {
      path: (meta.filePath as string) ?? "",
      startLine: (meta.startLine as number) ?? 1,
      endLine: (meta.endLine as number) ?? 1,
      score: r.score,
      snippet,
      source: "memory",
    };
  }

  /**
   * Hydrate the in-memory indexedFiles map from the database.
   * Queries existing active file-chunk entries and groups them by source file.
   * This prevents duplicate chunk creation when a fresh Db0MemoryBackend instance
   * is created (after /new, process restart, etc.) — the instance will see
   * existing chunks and compare content hashes instead of blindly re-indexing.
   */
  private async hydrateIndexFromDatabase(): Promise<void> {
    try {
      const allChunks = await this.harness.memory().list("user");
      const fileChunks = allChunks.filter(
        (m) => m.status === "active" && m.tags.includes("file-chunk"),
      );

      // Group by source file
      const byFile = new Map<string, { ids: string[]; contentHash: string | null }>();
      for (const chunk of fileChunks) {
        const sourceTag = chunk.tags.find((t) => t.startsWith("source:"));
        if (!sourceTag) continue;
        const filePath = sourceTag.slice("source:".length);

        let entry = byFile.get(filePath);
        if (!entry) {
          entry = { ids: [], contentHash: null };
          byFile.set(filePath, entry);
        }
        entry.ids.push(chunk.id);
        // Use metadata contentHash if available (from newer indexing)
        if (chunk.metadata?.contentHash) {
          entry.contentHash = chunk.metadata.contentHash as string;
        }
      }

      // Populate indexedFiles — use 0 for mtime to force content-hash comparison
      // on first sync (since we don't know the mtime at indexing time)
      for (const [filePath, { ids, contentHash }] of byFile) {
        this.indexedFiles.set(filePath, {
          mtime: 0, // Unknown — will trigger content read + hash comparison
          chunkIds: ids,
          contentHash: contentHash ?? "",
          lineCount: 0,
        });
      }

      if (byFile.size > 0) {
        log.info(`[db0] hydrated ${byFile.size} indexed files from database (${fileChunks.length} chunks)`);
      }
    } catch (err) {
      // Non-fatal — if hydration fails, sync will re-index (creating duplicates)
      // but at least it won't crash
      log.warn(`[db0] Failed to hydrate index from database:`, err);
    }
  }

  private hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Detect relationships between memory chunks.
   * Creates edges between chunks from different files that are semantically related.
   * Also detects potential contradictions (chunks about the same topic with conflicting signals).
   */
  private async detectRelationships(newChunkIds: string[]): Promise<void> {
    if (newChunkIds.length === 0) return;

    // Get all new chunks
    const newChunks: MemoryEntry[] = [];
    for (const id of newChunkIds) {
      const entry = await this.harness.memory().get(id);
      if (entry) newChunks.push(entry);
    }

    // For each new chunk, find related chunks from other files
    for (const chunk of newChunks) {
      const chunkContent = typeof chunk.content === "string"
        ? chunk.content
        : JSON.stringify(chunk.content);
      const chunkFile = (chunk.metadata?.filePath as string) ?? "";

      // Search for semantically similar chunks
      const embedding = await this.embeddingFn(chunkContent);
      const related = await this.harness.memory().search({
        embedding,
        scope: ["user"],
        limit: 5,
        minScore: 0.6,
        tags: ["file-chunk"],
      });

      for (const match of related) {
        // Skip self and chunks from the same file
        if (match.id === chunk.id) continue;
        const matchFile = (match.metadata?.filePath as string) ?? "";
        if (matchFile === chunkFile) continue;

        // Determine edge type based on content analysis
        const edgeType = this.classifyRelationship(chunkContent, match);

        try {
          await this.harness.memory().addEdge({
            sourceId: chunk.id,
            targetId: match.id,
            edgeType,
            metadata: {
              sourceFile: chunkFile,
              targetFile: matchFile,
              score: match.score,
            },
          });
        } catch {
          // Edge may already exist or entry may have been deleted
        }
      }
    }
  }

  /**
   * Classify the relationship between two chunks.
   * Uses simple heuristics — negation signals indicate contradiction,
   * high similarity with same topic indicates support, else related.
   */
  private classifyRelationship(
    sourceContent: string,
    target: MemorySearchResult,
  ): "related" | "contradicts" | "supports" {
    const targetContent = typeof target.content === "string"
      ? target.content
      : JSON.stringify(target.content);

    const sourceLower = sourceContent.toLowerCase();
    const targetLower = targetContent.toLowerCase();

    // Check for contradiction signals
    const negationWords = ["not", "don't", "doesn't", "never", "no longer", "instead of", "changed from", "unlike"];
    const sourceHasNegation = negationWords.some((w) => sourceLower.includes(w));
    const targetHasNegation = negationWords.some((w) => targetLower.includes(w));

    // If one has negation and the other doesn't, and they're highly similar,
    // they likely contradict
    if (
      target.score > 0.7 &&
      sourceHasNegation !== targetHasNegation
    ) {
      return "contradicts";
    }

    // High similarity with same sentiment → supports
    if (target.score > 0.75) {
      return "supports";
    }

    return "related";
  }
}
