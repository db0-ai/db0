import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  db0 as db0Core,
  createFallbackExtraction,
  defaultEmbeddingFn,
  formatMemories,
  mergeProfiles,
  type Context,
  type Db0Backend,
  type Db0Profile,
  type Harness,
  type LlmExtractionConfig,
  type MemoryScope,
  type MemorySearchResult,
} from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { Db0MemoryBackend, type Db0MemoryBackendConfig, type SyncContentDelta } from "./memory-backend.js";
import { createEmbeddingFn, createBatchEmbeddingFn, deriveEmbeddingId, autoDetectProvider, type EmbeddingProviderConfig, type EmbeddingProvider, type BatchEmbeddingFn } from "./embeddings.js";
import { log } from "./logger.js";

// === OpenClaw ContextEngine interface types (from PR #22201) ===

/** OpenClaw message type — we accept anything with role + content. */
export interface AgentMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

export type AssembleResult = {
  /** Ordered messages to use as model context */
  messages: AgentMessage[];
  /** Estimated total tokens in assembled context */
  estimatedTokens: number;
  /** Optional context-engine-provided instructions prepended to the runtime system prompt */
  systemPromptAddition?: string;
};

export type CompactResult = {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  result?: {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore: number;
    tokensAfter?: number;
    details?: unknown;
  };
};

export type IngestResult = {
  ingested: boolean;
};

export type IngestBatchResult = {
  ingestedCount: number;
};

export type BootstrapResult = {
  bootstrapped: boolean;
  importedMessages?: number;
  reason?: string;
};

export type ContextEngineInfo = {
  id: string;
  name: string;
  version?: string;
  ownsCompaction?: boolean;
  supportsSystemPromptAddition?: boolean;
  supportsIngestBatch?: boolean;
  supportsSubagents?: boolean;
  supportsCompactionSafetySnapshot?: boolean;
};

export type SubagentSpawnPreparation = {
  rollback: () => void | Promise<void>;
};

export type SubagentEndReason = "deleted" | "completed" | "swept" | "released";

type JournalRecord =
  | {
    kind: "ingest-message";
    ts: string;
    sessionId: string;
    role: string;
    content: string;
  }
  | {
    kind: "flush";
    ts: string;
    sessionId: string;
    reason: string;
  };

export interface ContextEngine {
  readonly info: ContextEngineInfo;

  bootstrap?(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    runtimeContext?: Record<string, unknown>;
  }): Promise<BootstrapResult>;

  ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult>;

  ingestBatch?(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult>;

  afterTurn?(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: Record<string, unknown>;
    legacyCompactionParams?: Record<string, unknown>;
  }): Promise<void>;

  assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult>;

  compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: Record<string, unknown>;
    legacyParams?: Record<string, unknown>;
  }): Promise<CompactResult>;

  prepareSubagentSpawn?(params: {
    parentSessionKey: string;
    childSessionKey: string;
    ttlMs?: number;
  }): Promise<SubagentSpawnPreparation | undefined>;

  onSubagentEnded?(params: { childSessionKey: string; reason: SubagentEndReason }): Promise<void>;

  dispose?(): Promise<void>;
}

// === Config ===

export interface Db0PluginConfig {
  /**
   * Workload profile — bundles tunable knobs for ingestion, retrieval,
   * extraction, and reconciliation. Use a built-in preset name
   * ("conversational", "knowledge-base", "coding-assistant", "high-recall", "minimal")
   * or pass a custom `Db0Profile` object.
   *
   * Individual config fields below override the profile's defaults.
   *
   * @example
   * // Use a built-in preset:
   * db0({ profile: "coding-assistant" })
   *
   * // Custom profile with overrides:
   * db0({ profile: "knowledge-base", searchLimit: 15 })
   *
   * // Fully custom profile:
   * db0({ profile: { name: "my-app", retrieval: { topK: 20, scoring: "hybrid" } } })
   */
  profile?: string | Db0Profile;

  /**
   * Storage backend.
   * - Omit or `undefined` → persistent SQLite at `~/.openclaw/db0.sqlite`
   * - `":memory:"` → in-memory SQLite (for testing)
   * - File path string (e.g. `"./data/memory.sqlite"`) → persistent SQLite
   * - `"postgresql://..."` or `"postgres://..."` → PostgreSQL + pgvector
   * - A `Db0Backend` instance → use directly
   */
  storage?: string | Db0Backend;

  /**
   * Embedding config. Accepts:
   * - `"gemini"`, `"openai"`, `"ollama"`, `"hash"` — use built-in provider
   * - `{ provider: "gemini", model: "...", dimensions: 768 }` — detailed config
   * - A raw `(text: string) => Promise<Float32Array>` function — BYO embeddings
   * - `"auto"` (default) — auto-detect best available provider:
   *   Gemini (free) → Ollama (local) → OpenAI → hash (fallback)
   *
   * When the provider changes, all existing memories are automatically
   * re-embedded on next bootstrap — no manual migration needed.
   *
   * @example
   * // Zero-config: auto-detects Gemini if GEMINI_API_KEY is set
   * db0()
   *
   * // Explicit provider:
   * db0({ embeddings: "gemini" })
   *
   * // In openclaw.json:
   * { "plugins": { "entries": { "db0": { "embeddings": "gemini" } } } }
   */
  embeddings?: EmbeddingProviderConfig | EmbeddingProvider | "auto" | ((text: string) => Promise<Float32Array>);

  /**
   * Extraction strategy.
   * - `"rules"` (default) — auto-extract from signal words, zero LLM calls
   * - `"manual"` — no auto-extraction, you call memory().write() yourself
   */
  extraction?: "rules" | "manual" | "llm";

  /** Max memories returned per search. Default: 8 */
  searchLimit?: number;

  /** Minimum cosine similarity score to include. Default: 0.4 */
  minScore?: number;

  /** LLM extraction config. Required when extraction is "llm". */
  llm?: LlmExtractionConfig;

  /** Agent ID to use in the harness. Default: "main" */
  agentId?: string;

  /**
   * User ID to use in the harness.
   * Defaults to `DB0_USER_ID` or `OPENCLAW_USER_ID`; if unset, falls back to
   * local OS username for stable per-user identity.
   */
  userId?: string;

  /**
   * Memory backend config. When provided, db0 indexes OpenClaw's markdown
   * memory files (MEMORY.md, memory/*.md) and serves semantic search.
   */
  memoryBackend?: {
    /** Workspace directory containing MEMORY.md and memory/. */
    workspaceDir?: string;
    /** Chunk size in characters. Default: 1600 (~400 tokens) */
    chunkSize?: number;
    /** Chunk overlap in characters. Default: 320 (~80 tokens) */
    chunkOverlap?: number;
  };

  /**
   * Tier 2: Batch extraction config.
   * Accumulates turns and runs one LLM call at trigger points.
   * If batchExtractFn is omitted, tier 2 is disabled.
   */
  batchExtraction?: {
    /** Trigger batch after this many assistant turns. Default: 10 */
    turnInterval?: number;
    /** LLM function for batch extraction. Receives accumulated turn texts. */
    batchExtractFn?: (turnTexts: string[]) => Promise<Array<{ content: string; scope: "task" | "session" | "user" | "agent"; tags: string[] }>>;
    /** Maximum accumulated content chars before forcing a batch. Default: 50000 */
    maxBufferSize?: number;
  };

  /**
   * Graph-augmented retrieval config.
   * After initial search, traverses memory edges to find related facts.
   */
  graphExpand?: {
    /** Enable graph expansion. Default: true */
    enabled?: boolean;
    /** Max additional memories from graph traversal. Default: 3 */
    maxExpand?: number;
    /** Edge types to traverse. Default: ["related", "supports", "derived"] */
    edgeTypes?: Array<"related" | "derived" | "contradicts" | "supports" | "supersedes">;
  };

  /**
   * Compaction delegate — called after db0's preservation steps to perform
   * actual transcript truncation. When running inside OpenClaw, this should
   * be wired to `compactEmbeddedPiSessionDirect`.
   *
   * If not provided, db0 auto-resolves the legacy context engine from
   * OpenClaw's process-global registry and delegates to it. If that also
   * fails (e.g. running outside OpenClaw), returns `compacted: false`.
   */
  compactDelegate?: (params: Record<string, unknown>) => Promise<{
    ok: boolean;
    compacted: boolean;
    reason?: string;
    result?: {
      summary?: string;
      firstKeptEntryId?: string;
      tokensBefore: number;
      tokensAfter?: number;
      details?: unknown;
    };
  }>;

  /**
   * Tier 3: Background reconciliation config.
   * Promotes high-access file-chunks, merges duplicates, cleans contradiction edges.
   */
  reconciliation?: {
    /** Minimum access count before a file-chunk is promoted. Default: 3 */
    promotionThreshold?: number;
    /** Maximum items to process per reconcile() call. Default: 20 */
    batchSize?: number;
    /** Auto-run reconciliation in afterTurn. Default: false */
    autoReconcile?: boolean;
    /** Run reconciliation every N turns when autoReconcile is true. Default: 25 */
    reconcileInterval?: number;
  };
}

// === Implementation ===

export class Db0ContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "db0",
    name: "db0 Semantic Memory",
    version: "0.1.0",
    ownsCompaction: false,
    supportsSystemPromptAddition: true,
    supportsIngestBatch: true,
    supportsSubagents: true,
    supportsCompactionSafetySnapshot: true,
  };

  /** Resolves when background embedding migration completes (if any). */
  get migrationReady(): Promise<void> {
    return this._migrationReady ?? Promise.resolve();
  }

  private config: Required<
    Pick<Db0PluginConfig, "searchLimit" | "minScore" | "agentId">
  > & Db0PluginConfig;
  private backend: Db0Backend | null = null;
  private harness: Harness | null = null;
  private childHarnesses: Map<string, Harness> = new Map();
  private _memoryBackend: Db0MemoryBackend | null = null;
  private stepCounter = 0;
  private embeddingFn: (text: string) => Promise<Float32Array>;
  private embeddingId: string;
  private detectedEmbeddingDimensions: number | null = null;
  private sessionFile: string | null = null;
  private sessionKey: string | null = null;
  private journalPath: string | null = null;

  // Background sync readiness gate — assemble() awaits this before searching
  private memorySyncReady: Promise<void> | null = null;

  // Background embedding migration — exposed so tests/callers can await completion
  private _migrationReady: Promise<void> | null = null;

  // Tier 2: batch extraction buffer
  private turnBuffer: Array<{ ts: string; sessionId: string; content: string }> = [];
  private turnsSinceLastBatch = 0;

  /** Resolved profile (if any). Readonly after construction. */
  readonly profile: Db0Profile | null;

  constructor(config: Db0PluginConfig = {}) {
    // Resolve profile → apply as defaults, then layer explicit config on top
    this.profile = resolveProfile(config.profile ?? null);
    const profileDefaults = this.profile
      ? profileToPluginDefaults(this.profile)
      : {};

    this.config = {
      searchLimit: 8,
      minScore: 0.4,
      agentId: "main",
      ...profileDefaults,
      ...config,
    };

    // Resolve embeddings config → function + ID
    const emb = config.embeddings;
    if (typeof emb === "function") {
      // BYO embedding function — user manages migration themselves
      this.embeddingFn = emb;
      this.embeddingId = "custom";
    } else if (emb && emb !== "auto") {
      // Explicit provider config
      this.embeddingFn = createEmbeddingFn(emb);
      this.embeddingId = deriveEmbeddingId(emb);
    } else {
      // "auto" or undefined — will be resolved in bootstrap via autoDetect
      this.embeddingFn = defaultEmbeddingFn;
      this.embeddingId = "hash"; // placeholder, updated in bootstrap
    }
  }

  /** Access the memory backend (available after bootstrap if configured). */
  get memoryBackend(): Db0MemoryBackend | null {
    return this._memoryBackend;
  }

  async bootstrap(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    runtimeContext?: Record<string, unknown>;
  }): Promise<BootstrapResult> {
    try {
      const sessionId = params.sessionId || `session-${Date.now()}`;
      let reason: string | undefined;
      this.sessionFile = params.sessionFile;
      this.sessionKey = params.sessionKey ?? null;
      this.journalPath = this.deriveJournalPath(params.sessionFile);

      this.backend = await this.resolveBackend(this.config.storage);

      // === Auto-detect embedding provider if not explicitly configured ===
      const emb = this.config.embeddings;
      if (!emb || emb === "auto") {
        const detected = await autoDetectProvider();
        if (detected !== "hash") {
          this.embeddingFn = createEmbeddingFn(detected);
          this.embeddingId = deriveEmbeddingId(detected);
        }
      }

      // === Embedding migration: detect provider changes and re-embed ===
      let embeddingMigration: { migrationNeeded: boolean; previousId?: string; currentId?: string } = { migrationNeeded: false };
      try {
        embeddingMigration = await this.checkEmbeddingMigration();
        if (embeddingMigration.migrationNeeded) {
          reason = `embedding migration: ${embeddingMigration.previousId} → ${embeddingMigration.currentId}`;
        }
      } catch (err) {
        log.warn(`[db0] Embedding migration check failed (continuing):`, this.errorMessage(err));
      }

      // Create batch embedding fn for the context() module
      const batchEmbedFn: BatchEmbeddingFn = typeof this.config.embeddings === "function"
        ? async (texts: string[]) => {
            const results: Float32Array[] = [];
            for (const text of texts) {
              results.push(await this.embeddingFn(text));
            }
            return results;
          }
        : createBatchEmbeddingFn(this.config.embeddings);

      this.harness = db0Core.harness({
        agentId: this.config.agentId,
        sessionId,
        userId: this.resolveUserId(),
        backend: this.backend,
        extraction: {
          durableFacts: this.config.extraction ?? "rules",
          llm: this.config.llm,
        },
        embeddingFn: this.embeddingFn,
        batchEmbeddingFn: batchEmbedFn,
        profile: this.profile ?? undefined,
      });

      await this.harness.log().append({
        event: "session.start",
        level: "info",
        data: {
          agentId: this.config.agentId,
          sessionId,
          sessionFile: params.sessionFile,
        },
      });

      // Defer embedding migration to background — must not block bootstrap
      if (embeddingMigration.migrationNeeded) {
        this._migrationReady = (async () => {
          try {
            await this.runEmbeddingMigration(embeddingMigration.currentId!);
          } catch (err) {
            log.warn(
              `[db0] Embedding migration failed (will retry on next bootstrap):`,
              this.errorMessage(err),
            );
          }
        })();
      }

      const checkpoint = await this.harness.state().restore();

      if (checkpoint) {
        this.stepCounter = checkpoint.step;
        await this.harness.log().append({
          event: "state.restored",
          level: "info",
          data: { step: checkpoint.step, label: checkpoint.label },
        });
      }

      // Initialize memory backend if configured (non-fatal — sync failures don't crash bootstrap)
      if (this.config.memoryBackend) {
        const workspaceDir =
          this.config.memoryBackend.workspaceDir ??
          this.defaultWorkspaceDir();

        if (workspaceDir && existsSync(workspaceDir)) {
          this._memoryBackend = new Db0MemoryBackend({
            workspaceDir,
            parentHarness: this.harness,
            embeddingFn: this.embeddingFn,
            batchEmbeddingFn: createBatchEmbeddingFn(typeof this.config.embeddings === "function" ? undefined : this.config.embeddings),
            chunkSize: this.config.memoryBackend.chunkSize,
            chunkOverlap: this.config.memoryBackend.chunkOverlap,
          });

          // Defer memory file sync to background — bootstrap must complete fast
          // so OpenClaw doesn't time out waiting for context engine readiness.
          // assemble() will await this promise before searching to avoid race conditions.
          const memBackend = this._memoryBackend;
          const harnessRef = this.harness;
          const selfRef = this;
          this.memorySyncReady = (async () => {
            try {
              const stats = await memBackend.sync();
              try {
                await harnessRef.log().append({
                  event: "memory.sync",
                  level: "info",
                  data: stats,
                });
              } catch { /* db may be closed if engine was disposed */ }

              // Auto-detect empty workspace with existing snapshots —
              // this means the user likely lost local data and needs to restore.
              if (stats.indexed === 0 && stats.unchanged === 0) {
                try {
                  const snapshots = await memBackend.listSnapshots();
                  if (snapshots.length > 0) {
                    log.warn(
                      `[db0] Workspace has no memory files but backend has ${snapshots.length} snapshot(s). ` +
                      `Run "db0-openclaw restore" to recover from backend.`,
                    );
                    try {
                      await harnessRef.log().append({
                        event: "memory.restore-available",
                        level: "warn",
                        data: {
                          snapshotCount: snapshots.length,
                          files: snapshots.map((s) => s.relativePath),
                        },
                      });
                    } catch { /* db may be closed */ }
                  }
                } catch { /* snapshot listing failed — non-fatal */ }
              }

              // Background incremental backup — snapshot any files that changed
              // since the last known snapshot. This ensures restore always has data,
              // not just after compaction events.
              if (stats.indexed > 0 || stats.unchanged > 0) {
                try {
                  const backupStats = await memBackend.snapshotChanged("bootstrap-backup");
                  if (backupStats.snapshotted > 0) {
                    try {
                      await harnessRef.log().append({
                        event: "memory.backup",
                        level: "info",
                        data: backupStats,
                      });
                    } catch { /* db may be closed */ }
                  }
                } catch { /* backup failed — non-fatal, will retry next session */ }
              }
            } catch (err) {
              log.warn(`[db0] Memory file sync failed (continuing):`, selfRef.errorMessage(err));
              try {
                await harnessRef.log().append({
                  event: "memory.sync.error",
                  level: "warn",
                  data: { error: selfRef.errorMessage(err) },
                });
              } catch { /* db may be closed if engine was disposed */ }
            }
          })();
        } else {
          reason = "memory backend workspace not found; continuing without file indexing";
        }
      }

      const importedMessages = await this.recoverFromJournal(sessionId);
      log.info(`[db0] bootstrap: session=${sessionId} userId=${this.resolveUserId()} agentId=${this.config.agentId} embeddingId=${this.embeddingId}${reason ? ` reason="${reason}"` : ""} importedMessages=${importedMessages}`);
      return reason
        ? { bootstrapped: true, reason, importedMessages }
        : { bootstrapped: true, importedMessages };
    } catch (err) {
      log.error(`[db0] bootstrap FAILED:`, err);
      await this.logEngineError("bootstrap.error", err, {
        sessionId: params.sessionId,
        sessionFile: params.sessionFile,
      });
      return { bootstrapped: false, reason: this.errorMessage(err) };
    }
  }

  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    try {
      if (!this.harness) {
        await this.ensureBootstrapped(params.sessionId);
      }
      if (!this.harness) {
        return {
          messages: params.messages,
          estimatedTokens: this.estimateTokens(params.messages),
        };
      }

      // Wait for background memory sync to complete before searching —
      // avoids race condition where first-turn assemble finds nothing.
      if (this.memorySyncReady) {
        await this.memorySyncReady;
        this.memorySyncReady = null;
      }

      // Find the last real user message for semantic search
      const lastUserMessage = this.findLastUserMessage(params.messages);
      let systemPromptAddition: string | undefined;

      if (lastUserMessage) {
        // === Issue 4, Option B: delegate structured-fact search to core pack() ===
        // Core context().pack() handles embedding, scoring, edge collection, and
        // budget-aware formatting for structured facts. OpenClaw adds file-chunk
        // results on top as an app-specific overlay — file-chunk indexing and
        // merging is too OpenClaw-specific to push into core.
        const graphCfg = this.config.graphExpand;
        // Over-fetch from pack() to give reranking enough candidates.
        // Template files score well on generic queries and crowd out
        // task-specific content. By fetching 3x, we ensure task content
        // makes it into the candidate set before score adjustment.
        const packLimit = this.config.searchLimit * 3;
        const packed = await this.harness.context().pack(lastUserMessage, {
          scopes: ["user", "agent", "session"],
          tokenBudget: params.tokenBudget,
          minScore: this.config.minScore,
          maxItems: packLimit,
          includeEdges: graphCfg?.enabled !== false,
        });

        // Collect the structured-fact memories for dedup against file chunks
        const memories: MemorySearchResult[] = [...packed.memories];

        // Also search the file-chunk index (MEMORY.md, memory/*.md) —
        // on fresh sessions, structured facts may not exist yet but
        // file chunks are indexed during sync.
        if (this._memoryBackend) {
          const fileResults = await this._memoryBackend.search(lastUserMessage, {
            maxResults: this.config.searchLimit,
            minScore: this.config.minScore,
          });
          // Merge file-chunk results as synthetic MemorySearchResult entries
          for (const fr of fileResults) {
            // Avoid duplicates — skip if snippet text already appears in structured results
            const isDuplicate = memories.some((m) => {
              const mc = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
              return mc.includes(fr.snippet.slice(0, 80));
            });
            if (!isDuplicate) {
              memories.push({
                id: `file:${fr.path}:${fr.startLine}`,
                content: fr.snippet,
                scope: "user",
                score: fr.score,
                tags: ["file-chunk", `source:${fr.path}`],
                summary: `[${fr.path}:${fr.startLine}-${fr.endLine}]`,
                createdAt: new Date().toISOString(),
                accessCount: 0,
                embedding: new Float32Array(0),
                status: "active",
              } as MemorySearchResult);
            }
          }
        }

        // === Score reranking ===
        // Template/scaffold files (BOOTSTRAP.md, SOUL.md, etc.) match almost
        // every query with moderate scores because they contain generic
        // instructional content. Penalize them so task-specific and
        // user-authored content surfaces. File snapshots (agent scope,
        // operational data) are also penalized.
        this.rerankMemories(memories);

        // Sort by adjusted score and trim to limit
        memories.sort((a, b) => b.score - a.score);
        if (memories.length > this.config.searchLimit) {
          memories.length = this.config.searchLimit;
        }

        if (memories.length > 0) {
          const scopeCounts: Record<string, number> = {};
          const fileChunkCount = memories.filter((m) => m.tags.includes("file-chunk")).length;
          for (const m of memories) { scopeCounts[m.scope] = (scopeCounts[m.scope] ?? 0) + 1; }
          log.info(`[db0] assemble: found ${memories.length} memories [structured=${memories.length - fileChunkCount} fileChunks=${fileChunkCount} scopes=${JSON.stringify(scopeCounts)}]`);
          for (const m of memories) {
            const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            log.debug(`[db0]   - [${m.scope}] score=${m.score.toFixed(3)} len=${c.length} "${c.slice(0, 80)}${c.length > 80 ? "..." : ""}"`)
          }
          // If file chunks were added, re-format the merged set.
          // Otherwise, use pack()'s pre-formatted text directly.
          if (memories.length > packed.memories.length) {
            const edges = await this.collectEdges(memories);
            systemPromptAddition = formatMemories(memories, params.tokenBudget, edges);
          } else {
            systemPromptAddition = packed.text;
          }
        }
      }

      if (systemPromptAddition) {
        log.info(`[db0] assemble: injecting context (~${Math.ceil(systemPromptAddition.length / 4)} tokens) for session ${params.sessionId}`);
      } else {
        log.info(`[db0] assemble: no relevant memories found for session ${params.sessionId} (query=${lastUserMessage?.slice(0, 60) ?? "none"})`);
      }

      return {
        messages: params.messages,
        estimatedTokens: this.estimateTokens(params.messages),
        systemPromptAddition,
      };
    } catch (err) {
      await this.logEngineError("assemble.error", err, {
        sessionId: params.sessionId,
      });
      return {
        messages: params.messages,
        estimatedTokens: this.estimateTokens(params.messages),
      };
    }
  }

  async ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    try {
      if (!this.harness) {
        await this.ensureBootstrapped(params.sessionId);
      }
      if (!this.harness) {
        return { ingested: false };
      }

      // Skip system/tool messages — only extract from user and assistant messages
      if (params.message.role !== "assistant" && params.message.role !== "user") {
        return { ingested: true };
      }

      const rawContent = typeof params.message.content === "string"
        ? params.message.content
        : this.extractTextFromContent(params.message.content);

      // Skip system-injected user messages (OpenClaw metadata, tool results)
      if (params.message.role === "user" && this.isSystemInjectedContent(rawContent)) {
        return { ingested: true };
      }

      const content = rawContent;
      this.appendJournal({
        kind: "ingest-message",
        ts: new Date().toISOString(),
        sessionId: params.sessionId,
        role: params.message.role,
        content,
      });

      const extraction = this.harness.extraction();
      const extracted = await extraction.extract(content);
      let dedupedCount = 0;
      let contradictionCount = 0;
      const effectiveSessionKey = params.sessionKey ?? this.sessionKey;

      for (const fact of extracted) {
        // Use sessionKey to tag session-scoped facts for isolation
        const tags = effectiveSessionKey && fact.scope === "session"
          ? [...fact.tags, `session-key:${effectiveSessionKey}`]
          : fact.tags;
        const quality = await this.harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags,
          sourceType: fact.sourceType,
          extractionMethod: fact.extractionMethod,
          confidence: fact.confidence,
        });
        dedupedCount += quality.deduped ? 1 : 0;
        contradictionCount += quality.contradictionLinked ? 1 : 0;
      }

      // Fallback extraction: when primary extraction finds nothing in a
      // substantial message, create a low-confidence memory to reduce
      // silent knowledge loss. Marked as fallback so retrieval can deprioritize.
      let fallbackUsed = false;
      if (extracted.length === 0) {
        const fallback = createFallbackExtraction(content);
        if (fallback) {
          const tags = effectiveSessionKey && fallback.scope === "session"
            ? [...fallback.tags, `session-key:${effectiveSessionKey}`]
            : fallback.tags;
          const quality = await this.harness.context().ingest(fallback.content, {
            scope: fallback.scope,
            tags,
            sourceType: fallback.sourceType,
            extractionMethod: fallback.extractionMethod,
            confidence: fallback.confidence,
          });
          dedupedCount += quality.deduped ? 1 : 0;
          fallbackUsed = !quality.deduped;
          log.debug("[db0] fallback extraction: %s", fallback.content.slice(0, 100));
        }
      }

      // Tier 2: accumulate in batch buffer
      this.turnBuffer.push({
        ts: new Date().toISOString(),
        sessionId: params.sessionId,
        content,
      });
      this.turnsSinceLastBatch++;

      this.stepCounter++;
      await this.harness.log().append({
        event: "turn.ingest",
        level: "info",
        data: {
          step: this.stepCounter,
          role: params.message.role,
          extractedCount: extracted.length,
          dedupedCount,
          contradictionCount,
          contentLength: content.length,
          ...(fallbackUsed ? { fallback: true } : {}),
        },
      });

      return { ingested: true };
    } catch (err) {
      await this.logEngineError("ingest.error", err, {
        sessionId: params.sessionId,
        role: params.message.role,
      });
      return { ingested: false };
    }
  }

  async ingestBatch(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult> {
    try {
      let ingestedCount = 0;
      for (const message of params.messages) {
        const result = await this.ingest({
          sessionId: params.sessionId,
          message,
          isHeartbeat: params.isHeartbeat,
        });
        if (result.ingested) ingestedCount++;
      }
      return { ingestedCount };
    } catch (err) {
      await this.logEngineError("ingestBatch.error", err, {
        sessionId: params.sessionId,
        messageCount: params.messages.length,
      });
      return { ingestedCount: 0 };
    }
  }

  async afterTurn(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: Record<string, unknown>;
  }): Promise<void> {
    try {
      if (!this.harness) {
        await this.ensureBootstrapped(params.sessionId, params.sessionFile);
      }
      if (!this.harness) return;

      // Ingest compaction summary as a high-priority memory — this contains
      // the distilled context from messages OpenClaw truncated during auto-compaction.
      if (params.autoCompactionSummary && params.autoCompactionSummary.trim()) {
        const embedding = await this.embeddingFn(params.autoCompactionSummary);
        await this.harness.memory().write({
          content: params.autoCompactionSummary,
          scope: "session",
          embedding,
          tags: ["compaction-summary", "auto-preserved"],
          metadata: {
            source: "openclaw-auto-compaction",
            preservedAt: new Date().toISOString(),
          },
        });
      }

      // Re-sync memory files if memory backend is active — the LLM may
      // have written new memories during this turn.
      if (this._memoryBackend) {
        const syncResult = await this._memoryBackend.sync();

        // Alert on destructive overwrites (e.g. compaction overwrote MEMORY.md)
        if (syncResult.overwrites.length > 0) {
          await this.harness.log().append({
            event: "memory.destructive-overwrite",
            level: "warn",
            data: {
              overwrites: syncResult.overwrites.map((o) => ({
                file: o.relativePath,
                linesBefore: o.previousLineCount,
                linesAfter: o.currentLineCount,
                delta: o.lineDelta,
              })),
            },
          });
        }

        // === Tier 1: Promote new file content to structured facts ===
        if (syncResult.newContent.length > 0) {
          await this.promoteTier1(params.sessionId, syncResult.newContent);
        }
      }

      // === Tier 2: Batch extraction trigger ===
      if (this.shouldTriggerBatchExtraction()) {
        await this.runBatchExtraction(params.sessionId);
      }

      // === Tier 3: Auto-reconciliation ===
      const reconCfg = this.config.reconciliation;
      if (reconCfg?.autoReconcile) {
        const interval = reconCfg.reconcileInterval ?? 25;
        if (this.stepCounter > 0 && this.stepCounter % interval === 0) {
          await this.reconcile(params.sessionId);
        }
      }

      this.stepCounter++;

      await this.harness.state().checkpoint({
        step: this.stepCounter,
        label: "after-turn",
        metadata: {
          messageCount: params.messages.length,
          prePromptMessageCount: params.prePromptMessageCount,
        },
      });

      await this.harness.log().append({
        event: "turn.afterTurn",
        level: "debug",
        data: {
          step: this.stepCounter,
          messageCount: params.messages.length,
        },
      });
      this.appendJournal({
        kind: "flush",
        ts: new Date().toISOString(),
        sessionId: params.sessionId,
        reason: "afterTurn",
      });
    } catch (err) {
      await this.logEngineError("afterTurn.error", err, {
        sessionId: params.sessionId,
      });
    }
  }

  async compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: Record<string, unknown>;
    legacyParams?: Record<string, unknown>;
  }): Promise<CompactResult> {
    try {
      if (!this.harness) {
        await this.ensureBootstrapped(params.sessionId, params.sessionFile);
      }
      if (!this.harness) {
        return {
          ok: true,
          compacted: false,
          reason: "not bootstrapped",
          result: {
            tokensBefore: params.currentTokenCount ?? 0,
          },
        };
      }

      // === Tier 2: flush batch buffer before compaction ===
      if (this.turnBuffer.length > 0 && this.config.batchExtraction?.batchExtractFn) {
        await this.runBatchExtraction(params.sessionId);
      }

      // === Pre-compaction preservation (Issue 3, Option B) ===
      // Before OpenClaw discards messages, extract and store any facts from
      // the turn buffer that tier-1/tier-2 extraction may have missed.
      // This is a best-effort safety net — OpenClaw still owns compaction,
      // but we ensure facts aren't lost when messages are truncated.
      if (this.turnBuffer.length > 0) {
        const preserveMessages = this.turnBuffer.map((t) => ({
          role: "assistant" as const,
          content: t.content,
        }));
        await this.harness.context().preserve(preserveMessages, {
          tags: ["pre-compaction"],
        });
      }

      // === Compaction Safety Net ===
      // Before OpenClaw discards messages or runs its compaction prompt,
      // we preserve everything that's about to be lost.

      const safetyData: Record<string, unknown> = {
        tokenBudget: params.tokenBudget,
        currentTokenCount: params.currentTokenCount,
      };

      // 1. Snapshot memory files — compaction prompts can overwrite MEMORY.md
      if (this._memoryBackend) {
        const snapshots = await this._memoryBackend.snapshotFiles();
        safetyData.fileSnapshots = snapshots.length;
        safetyData.snapshotFiles = snapshots.map((s) => ({
          path: s.relativePath,
          lines: s.lineCount,
          hash: s.contentHash,
        }));
      }

      await this.harness.log().append({
        event: "context.compact.safety-snapshot",
        level: "info",
        data: safetyData,
      });

      // 2. Delegate actual transcript truncation.
      // db0 does NOT own transcript truncation — it preserves facts and snapshots
      // above, then hands off to the legacy engine (which calls
      // compactEmbeddedPiSessionDirect) for the real session file rewrite.
      //
      // Resolution order:
      //   a) Explicit compactDelegate from config
      //   b) Auto-resolve legacy engine via OpenClaw's process-global registry
      //   c) Return compacted: false (preservation-only mode)
      const delegate = this.config.compactDelegate ?? this.resolveLegacyCompactDelegate();

      if (delegate) {
        const delegateParams = {
          ...(params.runtimeContext ?? {}),
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          sessionFile: params.sessionFile,
          tokenBudget: params.tokenBudget,
          currentTokenCount: params.currentTokenCount,
          force: params.force,
          compactionTarget: params.compactionTarget,
          customInstructions: params.customInstructions,
        };

        const delegateResult = await delegate(delegateParams);

        await this.harness.log().append({
          event: "context.compact.delegated",
          level: "info",
          data: {
            compacted: delegateResult.compacted,
            tokensBefore: delegateResult.result?.tokensBefore,
            tokensAfter: delegateResult.result?.tokensAfter,
            preservationDetails: safetyData,
          },
        });

        return {
          ok: delegateResult.ok,
          compacted: delegateResult.compacted,
          reason: delegateResult.reason,
          result: delegateResult.result
            ? {
                summary: delegateResult.result.summary,
                firstKeptEntryId: delegateResult.result.firstKeptEntryId,
                tokensBefore: delegateResult.result.tokensBefore,
                tokensAfter: delegateResult.result.tokensAfter,
                details: {
                  ...((delegateResult.result.details as Record<string, unknown>) ?? {}),
                  db0Preservation: safetyData,
                },
              }
            : undefined,
        };
      }

      // No delegate available — preservation-only mode. Return compacted: false
      // so the host knows truncation did not happen.
      return {
        ok: true,
        compacted: false,
        reason: "db0 preserved facts but no compact delegate available for truncation",
        result: {
          tokensBefore: params.currentTokenCount ?? 0,
          details: safetyData,
        },
      };
    } catch (err) {
      await this.logEngineError("compact.error", err, {
        sessionId: params.sessionId,
      });
      return {
        ok: false,
        compacted: false,
        reason: this.errorMessage(err),
        result: { tokensBefore: params.currentTokenCount ?? 0 },
      };
    }
  }

  /**
   * Auto-resolve a compact delegate by finding the legacy context engine in
   * OpenClaw's process-global registry. The registry uses Symbol.for() for
   * cross-module access — this is the intended pattern, not a hack.
   *
   * Returns null if not running inside OpenClaw or if the legacy engine is
   * not registered.
   */
  private resolveLegacyCompactDelegate(): Db0PluginConfig["compactDelegate"] | null {
    try {
      const registryKey = Symbol.for("openclaw.contextEngineRegistryState");
      const state = (globalThis as Record<symbol, unknown>)[registryKey] as
        | { engines?: Map<string, () => unknown> }
        | undefined;
      const legacyFactory = state?.engines?.get("legacy");
      if (!legacyFactory) return null;

      return async (params) => {
        const legacyEngine = await (legacyFactory as () => Promise<ContextEngine>)();
        const result = await legacyEngine.compact(params as Parameters<ContextEngine["compact"]>[0]);
        return result;
      };
    } catch {
      return null;
    }
  }

  /**
   * Force a journal flush marker. Useful from lifecycle hooks before reset/restart.
   */
  async flush(reason = "manual"): Promise<{ ok: boolean; journalPath?: string }> {
    try {
      const sessionId = this.harness?.sessionId ?? "unknown";
      this.appendJournal({
        kind: "flush",
        ts: new Date().toISOString(),
        sessionId,
        reason,
      });
      if (this.harness) {
        await this.harness.log().append({
          event: "journal.flush",
          level: "info",
          data: { reason, journalPath: this.journalPath },
        });
      }
      return { ok: true, journalPath: this.journalPath ?? undefined };
    } catch (err) {
      await this.logEngineError("journal.flush.error", err, { reason });
      return { ok: false, journalPath: this.journalPath ?? undefined };
    }
  }

  async recover(reason = "manual"): Promise<{ ok: boolean; importedMessages: number }> {
    try {
      const sessionId = this.harness?.sessionId ?? "unknown";
      const importedMessages = await this.recoverFromJournal(sessionId);
      if (this.harness) {
        await this.harness.log().append({
          event: "journal.recover",
          level: "info",
          data: { reason, importedMessages, journalPath: this.journalPath },
        });
      }
      return { ok: true, importedMessages };
    } catch (err) {
      await this.logEngineError("journal.recover.error", err, { reason });
      return { ok: false, importedMessages: 0 };
    }
  }

  async prepareSubagentSpawn(params: {
    parentSessionKey: string;
    childSessionKey: string;
    ttlMs?: number;
  }): Promise<SubagentSpawnPreparation | undefined> {
    try {
      if (!this.harness) return undefined;

      const child = this.harness.spawn({
        agentId: `child-${params.childSessionKey}`,
        sessionId: params.childSessionKey,
      });

      this.childHarnesses.set(params.childSessionKey, child);

      await child.log().append({
        event: "session.start",
        level: "info",
        data: {
          parentSessionKey: params.parentSessionKey,
        },
      });

      await this.harness.log().append({
        event: "subagent.spawn",
        level: "info",
        data: {
          childSessionKey: params.childSessionKey,
        },
      });

      return {
        rollback: async () => {
          child.close();
          this.childHarnesses.delete(params.childSessionKey);
        },
      };
    } catch (err) {
      await this.logEngineError("subagent.spawn.error", err, {
        parentSessionKey: params.parentSessionKey,
        childSessionKey: params.childSessionKey,
      });
      return undefined;
    }
  }

  async onSubagentEnded(params: {
    childSessionKey: string;
    reason: SubagentEndReason;
  }): Promise<void> {
    try {
      if (!this.harness) return;

      const child = this.childHarnesses.get(params.childSessionKey);

      await this.harness.log().append({
        event: "subagent.ended",
        level: "info",
        data: {
          childSessionKey: params.childSessionKey,
          reason: params.reason,
        },
      });

      if (child) {
        await child.log().append({
          event: "session.end",
          level: "info",
          data: { reason: params.reason },
        });
        child.close();
        this.childHarnesses.delete(params.childSessionKey);
      }
    } catch (err) {
      await this.logEngineError("subagent.ended.error", err, {
        childSessionKey: params.childSessionKey,
        reason: params.reason,
      });
    }
  }

  // === Tier 1: Promote file content to structured facts ===

  private async promoteTier1(
    sessionId: string,
    deltas: SyncContentDelta[],
  ): Promise<void> {
    if (!this.harness) return;

    let factsExtracted = 0;
    let deduped = 0;
    let contradictions = 0;

    const extraction = this.harness.extraction();

    for (const delta of deltas) {
      // Run extraction on the file content — uses the configured strategy
      // (rules by default). This is zero LLM cost for rules extraction.
      const extracted = await extraction.extract(delta.content);

      for (const fact of extracted) {
        const quality = await this.harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: [...fact.tags, "tier-1", "file-promoted", `source:${delta.relativePath}`],
        });
        factsExtracted++;
        if (quality.deduped) deduped++;
        if (quality.contradictionLinked) contradictions++;
      }
    }

    if (factsExtracted > 0 || deduped > 0) {
      await this.harness.log().append({
        event: "tier1.promotion",
        level: "info",
        data: {
          filesProcessed: deltas.length,
          factsExtracted,
          deduped,
          contradictions,
        },
      });
    }
  }

  // === Tier 2: Batch extraction ===

  private shouldTriggerBatchExtraction(): boolean {
    const cfg = this.config.batchExtraction;
    if (!cfg?.batchExtractFn) return false;
    if (this.turnBuffer.length === 0) return false;
    const interval = cfg.turnInterval ?? 10;
    if (this.turnsSinceLastBatch >= interval) return true;
    const bufferSize = this.turnBuffer.reduce((sum, t) => sum + t.content.length, 0);
    if (bufferSize >= (cfg.maxBufferSize ?? 50000)) return true;
    return false;
  }

  private async runBatchExtraction(sessionId: string): Promise<void> {
    if (!this.harness || this.turnBuffer.length === 0) return;
    const cfg = this.config.batchExtraction;
    if (!cfg?.batchExtractFn) return;

    const texts = this.turnBuffer.map((t) => t.content);

    try {
      const extracted = await cfg.batchExtractFn(texts);
      let deduped = 0;
      let contradictions = 0;

      for (const fact of extracted) {
        const quality = await this.harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: [...fact.tags, "tier-2", "batch-extracted"],
        });
        if (quality.deduped) deduped++;
        if (quality.contradictionLinked) contradictions++;
      }

      await this.harness.log().append({
        event: "tier2.batch-extraction",
        level: "info",
        data: {
          turnsProcessed: this.turnBuffer.length,
          factsExtracted: extracted.length,
          deduped,
          contradictions,
        },
      });
    } catch (err) {
      await this.logEngineError("tier2.batch-extraction.error", err, {
        turnsBuffered: this.turnBuffer.length,
      });
    }

    this.turnBuffer = [];
    this.turnsSinceLastBatch = 0;
  }

  // === Tier 3: Reconciliation ===

  async reconcile(sessionId?: string): Promise<{
    promoted: number;
    merged: number;
    contradictionsCleaned: number;
  }> {
    if (!this.harness) return { promoted: 0, merged: 0, contradictionsCleaned: 0 };

    const cfg = this.config.reconciliation ?? {};

    try {
      const result = await this.harness.context().reconcile({
        promotionThreshold: cfg.promotionThreshold,
        batchSize: cfg.batchSize,
      });

      await this.harness.log().append({
        event: "tier3.reconciliation",
        level: "info",
        data: { ...result },
      });

      return result;
    } catch (err) {
      await this.logEngineError("tier3.reconciliation.error", err, {});
      return { promoted: 0, merged: 0, contradictionsCleaned: 0 };
    }
  }

  // === Lifecycle ===

  async dispose(): Promise<void> {
    if (this._memoryBackend) {
      await this._memoryBackend.dispose();
      this._memoryBackend = null;
    }

    if (this.harness) {
      for (const [, child] of this.childHarnesses) {
        child.close();
      }
      this.childHarnesses.clear();

      await this.harness.log().append({
        event: "session.end",
        level: "info",
      });
      this.harness.close();
      this.harness = null;
      this.backend = null;
    }
  }

  // === Private ===

  private findLastUserMessage(messages: AgentMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        const content = messages[i].content;
        const text = typeof content === "string" ? content : this.extractTextFromContent(content);
        // Skip system-injected messages (OpenClaw wraps metadata as "user" role)
        if (this.isSystemInjectedContent(text)) continue;
        // Skip very short messages (likely heartbeats or empty prompts)
        if (text.trim().length < 5) continue;
        return text;
      }
    }
    return undefined;
  }

  /** Detect system-injected content disguised as user messages. */
  private isSystemInjectedContent(text: string): boolean {
    // OpenClaw injects system metadata wrapped in XML-like tags
    if (text.includes("<system-reminder>") || text.includes("</system-reminder>")) return true;
    if (text.includes("<system>") || text.includes("</system>")) return true;
    // Tool results injected as user messages
    if (text.startsWith("<tool_result>") || text.startsWith("<function_results>")) return true;
    // If the entire content is XML tags with no human-readable text
    const stripped = text.replace(/<[^>]+>/g, "").trim();
    if (stripped.length === 0 && text.length > 20) return true;
    return false;
  }

  /** Extract plain text from structured message content (text blocks, arrays, etc.) */
  private extractTextFromContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const block of content) {
        if (typeof block === "string") {
          textParts.push(block);
        } else if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
          textParts.push(block.text);
        }
      }
      return textParts.join("\n");
    }
    return JSON.stringify(content);
  }

  private estimateTokens(messages: AgentMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
      total += Math.ceil(content.length / 4);
    }
    return total;
  }

  private async resolveBackend(
    storage: string | Db0Backend | undefined,
  ): Promise<Db0Backend> {
    if (storage && typeof storage !== "string") {
      return storage;
    }

    if (
      typeof storage === "string" &&
      (storage.startsWith("postgresql://") ||
        storage.startsWith("postgres://"))
    ) {
      const { createPostgresBackend } = await import(
        "@db0-ai/backends-postgres"
      );
      const dimensions = await this.getEmbeddingDimensions();
      return createPostgresBackend({ connectionString: storage, dimensions });
    }

    let dbPath: string | undefined;
    if (typeof storage === "string") {
      dbPath = storage === ":memory:" ? undefined : storage;
    } else {
      dbPath = this.defaultDbPath();
    }

    return createSqliteBackend({ dbPath });
  }

  private async getEmbeddingDimensions(): Promise<number> {
    if (this.detectedEmbeddingDimensions !== null) {
      return this.detectedEmbeddingDimensions;
    }

    try {
      const probe = await this.embeddingFn("__db0_dimension_probe__");
      if (probe.length > 0) {
        this.detectedEmbeddingDimensions = probe.length;
        return this.detectedEmbeddingDimensions;
      }
    } catch {
      // If probing fails (provider temporarily unavailable), keep compatibility
      // with existing Postgres default dimensions.
    }

    this.detectedEmbeddingDimensions = 1536;
    return this.detectedEmbeddingDimensions;
  }

  private deriveJournalPath(sessionFile: string): string {
    const resolved = sessionFile && sessionFile.trim().length > 0
      ? sessionFile
      : join(this.defaultWorkspaceDir() ?? homedir(), "session.jsonl");
    return `${resolved}.db0.journal.ndjson`;
  }

  private appendJournal(record: JournalRecord): void {
    if (!this.journalPath) return;
    try {
      mkdirSync(dirname(this.journalPath), { recursive: true });
      appendFileSync(this.journalPath, `${JSON.stringify(record)}\n`, "utf-8");
    } catch {
      // Best-effort journaling; don't break turns.
    }
  }

  private async recoverFromJournal(sessionId: string): Promise<number> {
    if (!this.journalPath || !existsSync(this.journalPath) || !this.harness) {
      return 0;
    }

    const raw = readFileSync(this.journalPath, "utf-8");
    if (!raw.trim()) return 0;
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const seen = new Set<string>();
    let imported = 0;

    // Replay newest first, bounded to avoid unbounded cold-start recovery.
    for (let i = lines.length - 1; i >= 0 && imported < 200; i--) {
      let rec: JournalRecord | null = null;
      try {
        rec = JSON.parse(lines[i]) as JournalRecord;
      } catch {
        continue;
      }
      if (!rec || rec.kind !== "ingest-message" || rec.sessionId !== sessionId) {
        continue;
      }
      if (rec.role !== "assistant") continue;
      const dedupKey = this.normalizeText(rec.content);
      if (!dedupKey || seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const result = await this.ingest({
        sessionId,
        message: { role: "assistant", content: rec.content },
      });
      if (result.ingested) imported++;
    }

    return imported;
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private async logEngineError(
    event: string,
    err: unknown,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const payload = {
      ...(data ?? {}),
      error: this.errorMessage(err),
    };
    if (this.harness) {
      try {
        await this.harness.log().append({
          event,
          level: "error",
          data: payload,
        });
        return;
      } catch {
        // Fall through to console for last-resort visibility.
      }
    }
    log.error(`[db0] ${event}:`, payload);
  }

  private defaultWorkspaceDir(): string | undefined {
    const candidates = [
      join(homedir(), ".openclaw", "workspace"),
      join(homedir(), ".config", "openclaw", "workspace"),
    ];
    return candidates.find((d) => existsSync(d));
  }

  private defaultDbPath(): string {
    const candidates = [
      join(homedir(), ".openclaw"),
      join(homedir(), ".config", "openclaw"),
    ];

    let dir = candidates.find((d) => existsSync(d));
    if (!dir) {
      dir = candidates[0];
      mkdirSync(dir, { recursive: true });
    }

    return join(dir, "db0.sqlite");
  }

  private normalizeText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  // === Embedding migration ===

  private async checkEmbeddingMigration(): Promise<{
    migrationNeeded: boolean;
    previousId?: string;
    currentId?: string;
  }> {
    if (!this.backend) return { migrationNeeded: false };

    const currentId = this.embeddingId;
    const previousId = await this.backend.metaGet("embedding_id");

    if (previousId === null) {
      // First run — store current config, no migration needed
      await this.backend.metaSet("embedding_id", currentId);
      return { migrationNeeded: false, currentId };
    }

    if (previousId === currentId) {
      return { migrationNeeded: false, currentId };
    }

    return { migrationNeeded: true, previousId, currentId };
  }

  private async runEmbeddingMigration(newEmbeddingId: string): Promise<void> {
    if (!this.harness || !this.backend) return;

    // Resolve batch embedding function for migration
    const batchEmbedFn: BatchEmbeddingFn = typeof this.config.embeddings === "function"
      ? async (texts: string[]) => {
          const results: Float32Array[] = [];
          for (const text of texts) {
            results.push(await this.embeddingFn(text));
          }
          return results;
        }
      : createBatchEmbeddingFn(this.config.embeddings);

    log.info(`[db0] Re-embedding memories for provider change → ${newEmbeddingId}`);

    const result = await this.harness.migrateEmbeddings(
      this.embeddingFn,
      batchEmbedFn,
      newEmbeddingId,
    );

    await this.harness.log().append({
      event: "embedding.migration",
      level: "info",
      data: {
        newEmbeddingId,
        ...result,
      },
    });

    log.info(
      `[db0] Embedding migration complete: ${result.reEmbedded} re-embedded` +
        (result.failed > 0 ? `, ${result.failed} failed` : ""),
    );
  }

  private async ensureBootstrapped(sessionId: string, sessionFile?: string, sessionKey?: string): Promise<void> {
    if (this.harness) return;
    const file = sessionFile
      ?? this.sessionFile
      ?? join(homedir(), ".openclaw", "sessions", `${sessionId}.jsonl`);
    await this.bootstrap({ sessionId, sessionKey: sessionKey ?? this.sessionKey ?? undefined, sessionFile: file });
  }

  private resolveUserId(): string | undefined {
    // Priority 1: Explicit config (strongest — operator knows what they want)
    if (this.config.userId && this.config.userId.trim()) {
      return this.config.userId.trim();
    }

    // Priority 2: Environment variable override
    const envUserId = process.env.DB0_USER_ID ?? process.env.OPENCLAW_USER_ID;
    if (envUserId && envUserId.trim()) {
      return envUserId.trim();
    }

    // Priority 3: OS username — namespace with agentId to prevent cross-agent bleed.
    // Without namespacing, all agents on the same machine share user-scoped memories,
    // which causes unintended contamination between projects.
    const processUser = process.env.USER ?? process.env.USERNAME ?? process.env.LOGNAME;
    if (processUser && processUser.trim()) {
      return `${processUser.trim()}@${this.config.agentId}`;
    }

    try {
      const name = userInfo().username;
      if (name && name.trim()) {
        return `${name.trim()}@${this.config.agentId}`;
      }
    } catch {
      // userInfo() unavailable
    }

    return undefined;
  }

  /**
   * Apply score adjustments to prioritize user-authored and task-specific
   * content over template/scaffold files.
   *
   * Template files (BOOTSTRAP.md, SOUL.md, IDENTITY.md, AGENTS.md,
   * HEARTBEAT.md, TOOLS.md) contain generic instructional content that
   * matches almost any query with moderate cosine similarity. Without
   * adjustment, they crowd out task-specific memories from files like
   * memory/tldl_task.md or memory/2026-03-11.md.
   *
   * Score multipliers:
   * - Template file chunks: ×0.6 (penalize generic scaffold)
   * - File snapshots (agent scope): ×0.5 (operational data, not context)
   * - User-authored memory/ files: ×1.15 (boost task-specific content)
   * - Non-file-chunk facts: ×1.0 (no change — already task-specific)
   */
  private rerankMemories(memories: MemorySearchResult[]): void {
    // Template files that are part of the OpenClaw workspace scaffold.
    // Their content is generic and already available via system prompt.
    // Template files that are part of the OpenClaw workspace scaffold.
    // Their content is generic instructional text already in the system prompt.
    // Penalize hard (×0.3) so they only surface when directly relevant.
    const templateFiles = new Set([
      "BOOTSTRAP.md", "SOUL.md", "IDENTITY.md",
      "AGENTS.md", "HEARTBEAT.md", "TOOLS.md",
      "MEMORY.md",
    ]);

    for (const m of memories) {
      const sourceTag = m.tags.find((t) => t.startsWith("source:"));
      const isFileChunk = m.tags.includes("file-chunk");
      const isSnapshot = m.tags.includes("file-snapshot");

      if (isSnapshot) {
        m.score *= 0.3;
      } else if (isFileChunk && sourceTag) {
        const fileName = sourceTag.slice("source:".length);
        if (templateFiles.has(fileName)) {
          m.score *= 0.3;
        } else if (fileName.startsWith("memory/")) {
          m.score *= 1.15;
        }
      }

      // Low-confidence fallback memories get deprioritized so they don't
      // crowd out explicit user-stated facts in the context window.
      if (m.confidence !== null && m.confidence < 1.0) {
        m.score *= m.confidence;
      }
    }
  }

  private async collectEdges(
    memories: MemorySearchResult[],
  ): Promise<Map<string, Array<{ targetId: string; edgeType: string }>>> {
    if (!this.harness) return new Map();

    const edgeMap = new Map<string, Array<{ targetId: string; edgeType: string }>>();
    const memoryIds = new Set(memories.map((m) => m.id));

    for (const mem of memories) {
      try {
        const edges = await this.harness.memory().getEdges(mem.id);
        const relevant = edges.filter(
          (e) => memoryIds.has(e.sourceId) || memoryIds.has(e.targetId),
        );
        if (relevant.length > 0) {
          edgeMap.set(
            mem.id,
            relevant.map((e) => ({
              targetId: e.sourceId === mem.id ? e.targetId : e.sourceId,
              edgeType: e.edgeType,
            })),
          );
        }
      } catch {
        // Edge query failed — skip
      }
    }

    return edgeMap;
  }

}

// === Profile helpers ===

import { PROFILES } from "@db0-ai/core";

/**
 * Resolve a profile from a name string or Db0Profile object.
 * Returns null if no profile specified.
 */
function resolveProfile(input: string | Db0Profile | null): Db0Profile | null {
  if (!input) return null;
  if (typeof input === "string") {
    const profile = PROFILES[input];
    if (!profile) {
      throw new Error(
        `Unknown profile "${input}". Available: ${Object.keys(PROFILES).join(", ")}`,
      );
    }
    return profile;
  }
  return input;
}

/**
 * Map a Db0Profile's settings to Db0PluginConfig fields.
 * Profile values become defaults — explicit config values override them.
 */
function profileToPluginDefaults(profile: Db0Profile): Partial<Db0PluginConfig> {
  const defaults: Partial<Db0PluginConfig> = {};

  if (profile.retrieval?.topK !== undefined) {
    defaults.searchLimit = profile.retrieval.topK;
  }
  if (profile.retrieval?.minScore !== undefined) {
    defaults.minScore = profile.retrieval.minScore;
  }
  if (profile.extraction?.strategy !== undefined) {
    defaults.extraction = profile.extraction.strategy;
  }
  if (profile.ingest) {
    const mb = defaults.memoryBackend ?? {};
    if (profile.ingest.chunkSize !== undefined) mb.chunkSize = profile.ingest.chunkSize;
    if (profile.ingest.chunkOverlap !== undefined) mb.chunkOverlap = profile.ingest.chunkOverlap;
    if (Object.keys(mb).length > 0) defaults.memoryBackend = mb;
  }
  if (profile.retrieval?.graphExpand) {
    defaults.graphExpand = {
      enabled: profile.retrieval.graphExpand.enabled,
      maxExpand: profile.retrieval.graphExpand.maxExpand,
      edgeTypes: profile.retrieval.graphExpand.edgeTypes,
    };
  }
  if (profile.reconciliation) {
    defaults.reconciliation = { ...profile.reconciliation };
  }
  if (profile.extraction) {
    if (profile.extraction.batchInterval !== undefined || profile.extraction.maxBufferSize !== undefined) {
      defaults.batchExtraction = {
        turnInterval: profile.extraction.batchInterval,
        maxBufferSize: profile.extraction.maxBufferSize,
      };
    }
  }

  return defaults;
}

// === Factory ===

/**
 * Create a db0 ContextEngine for OpenClaw with zero or minimal configuration.
 *
 * @example
 * // Zero-config — persistent SQLite, hash embeddings, rules extraction
 * plugins: { contextEngine: db0() }
 *
 * @example
 * // Use a built-in profile
 * plugins: { contextEngine: db0({ profile: "coding-assistant" }) }
 *
 * @example
 * // Cross-device sync via hosted Postgres
 * plugins: { contextEngine: db0({ storage: "postgresql://...@neon.tech/db0" }) }
 */
export function db0(config: Db0PluginConfig = {}): Db0ContextEngine {
  return new Db0ContextEngine(config);
}
