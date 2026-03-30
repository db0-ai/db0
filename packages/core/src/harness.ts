import { Context } from "./components/context.js";
import { Log } from "./components/log.js";
import { Memory } from "./components/memory.js";
import { State } from "./components/state.js";
import { createExtractionStrategy } from "./extraction/index.js";
import { defaultEmbeddingFn } from "./util/embed.js";
import type { BatchEmbeddingFn, EmbeddingFn, ExtractionStrategy, HarnessConfig } from "./types.js";

export interface SpawnConfig {
  agentId: string;
  sessionId: string;
  /** Override userId. Defaults to parent's userId (so child inherits user-scoped memories). */
  userId?: string;
  /** Override extraction strategy. Defaults to parent's strategy. */
  extraction?: { durableFacts?: "rules" | "manual" | "llm" };
}

export class Harness {
  readonly agentId: string;
  readonly sessionId: string;
  readonly userId: string | null;
  /** If this harness was spawned from a parent, the parent's agentId. */
  readonly parentAgentId: string | null;

  private _memory: Memory | null = null;
  private _state: State | null = null;
  private _log: Log | null = null;
  private _context: Context | null = null;
  private _extraction: ExtractionStrategy;
  private config: HarnessConfig;
  private children: Harness[] = [];
  private isChild: boolean;

  constructor(config: HarnessConfig, parentAgentId?: string) {
    this.config = config;
    this.agentId = config.agentId;
    this.sessionId = config.sessionId;
    this.userId = config.userId ?? null;
    this.parentAgentId = parentAgentId ?? null;
    this.isChild = !!parentAgentId;
    this._extraction = createExtractionStrategy(
      config.extraction?.durableFacts ?? "rules",
      config.extraction?.llm,
    );
  }

  memory(): Memory {
    if (!this._memory) {
      this._memory = new Memory(
        this.config.backend,
        this.agentId,
        this.sessionId,
        this.userId,
        this.config.summarizeFn,
      );
    }
    return this._memory;
  }

  state(): State {
    if (!this._state) {
      this._state = new State(
        this.config.backend,
        this.agentId,
        this.sessionId,
      );
    }
    return this._state;
  }

  log(): Log {
    if (!this._log) {
      this._log = new Log(
        this.config.backend,
        this.agentId,
        this.sessionId,
      );
    }
    return this._log;
  }

  extraction(): ExtractionStrategy {
    return this._extraction;
  }

  /**
   * Context lifecycle primitive — ingest, pack, preserve, reconcile.
   *
   * Uses the embeddingFn from config, falling back to hashEmbed.
   * For batch operations (preserve), uses batchEmbeddingFn if provided,
   * otherwise wraps embeddingFn sequentially.
   */
  context(): Context {
    if (!this._context) {
      const embeddingFn: EmbeddingFn =
        this.config.embeddingFn ?? defaultEmbeddingFn;
      const batchEmbeddingFn: BatchEmbeddingFn =
        this.config.batchEmbeddingFn ?? sequentialBatch(embeddingFn);
      this._context = new Context(
        this,
        embeddingFn,
        batchEmbeddingFn,
        this.config.profile ?? {},
        this.config.consolidateFn,
      );
    }
    return this._context;
  }

  /**
   * Check whether the current embedding provider matches what was used
   * to embed stored memories. Returns migration status.
   *
   * The embeddingId is a stable string like "gemini:gemini-embedding-2-preview"
   * stored in the db0_meta key-value store.
   */
  async embeddingStatus(
    currentId: string,
  ): Promise<{ currentId: string; storedId: string | null; migrationNeeded: boolean }> {
    const storedId = await this.config.backend.metaGet("embedding_id");
    return {
      currentId,
      storedId,
      migrationNeeded: storedId !== null && storedId !== currentId,
    };
  }

  /**
   * Re-embed all active memories with a new embedding provider.
   *
   * Uses batchEmbeddingFn for efficiency. Updates the stored embeddingId
   * on success.
   */
  async migrateEmbeddings(
    embeddingFn: EmbeddingFn,
    batchEmbeddingFn: BatchEmbeddingFn,
    newId: string,
  ): Promise<{ reEmbedded: number; failed: number }> {
    const active = await this.memory().list();
    const activeMemories = active.filter((m) => m.status === "active");

    if (activeMemories.length === 0) {
      await this.config.backend.metaSet("embedding_id", newId);
      return { reEmbedded: 0, failed: 0 };
    }

    // Batch-embed all content
    const contents = activeMemories.map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    );
    const newEmbeddings = await batchEmbeddingFn(contents);

    let reEmbedded = 0;
    let failed = 0;

    for (let i = 0; i < activeMemories.length; i++) {
      try {
        const mem = activeMemories[i];
        await this.memory().write({
          content: mem.content,
          scope: mem.scope,
          embedding: newEmbeddings[i],
          tags: mem.tags,
          metadata: {
            ...mem.metadata,
            embeddingMigratedAt: new Date().toISOString(),
            embeddingMigratedFrom: mem.id,
          },
          supersedes: mem.id,
        });
        reEmbedded++;
      } catch {
        failed++;
      }
    }

    await this.config.backend.metaSet("embedding_id", newId);
    return { reEmbedded, failed };
  }

  /**
   * Spawn a child harness that shares the same backend.
   *
   * The child inherits:
   * - The same backend (same database — shared storage)
   * - The same userId (so user-scoped memories are visible)
   * - Its own agentId and sessionId (so task/session memories are isolated)
   *
   * Scope visibility with a different agentId:
   * - `user` scoped memories ARE shared (filtered by userId, not agentId)
   * - `agent` scoped memories are NOT shared (filtered by agentId — child
   *   has its own agentId, so it cannot see parent's agent-scoped data)
   * - `task` and `session` scoped memories are isolated by sessionId
   * - No backflow step needed — data written by child is already in the shared DB
   */
  spawn(config: SpawnConfig): Harness {
    const child = new Harness(
      {
        agentId: config.agentId,
        sessionId: config.sessionId,
        userId: config.userId ?? this.config.userId,
        backend: this.config.backend,
        extraction: config.extraction ?? this.config.extraction,
        embeddingFn: this.config.embeddingFn,
        batchEmbeddingFn: this.config.batchEmbeddingFn,
        profile: this.config.profile,
      },
      this.agentId,
    );

    this.children.push(child);
    return child;
  }

  /**
   * Close this harness. Only the root harness closes the backend.
   * Child harnesses just clean up their references.
   */
  close(): void {
    // Close all children first
    for (const child of this.children) {
      child.close();
    }
    this.children = [];

    // Only root harness closes the backend connection
    if (!this.isChild) {
      this.config.backend.close();
    }
  }
}

/** Wrap a single-text embedding function into a sequential batch function. */
function sequentialBatch(singleFn: EmbeddingFn): BatchEmbeddingFn {
  return async (texts: string[]) => {
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await singleFn(text));
    }
    return results;
  };
}
