import type { Db0Backend, MemorySearchResult, ChunkEnrichFn } from "@db0-ai/core";
import { chunkText, enrichChunks, rrfMerge, RulesExtractionStrategy } from "@db0-ai/core";
import type { MemoryAdapter, ConversationSession, QueryExecution } from "../types.js";

/**
 * Query expansion function (Adaptive Query Expansion).
 * Takes the original query and returns N semantically diverse reformulations.
 */
export type QueryExpandFn = (query: string) => Promise<string[]>;

export interface Db0AdapterOptions {
  /** Factory to create a fresh backend. Called on setup() and reset(). */
  createBackend: () => Promise<Db0Backend>;
  /** Embedding function. */
  embeddingFn: (text: string) => Promise<Float32Array>;
  /** Agent ID for the benchmark harness. */
  agentId?: string;
  /** User ID for the benchmark harness. */
  userId?: string;
  /** Minimum similarity score threshold. */
  minScore?: number;
  /** Scoring mode for search. */
  scoring?: "similarity" | "hybrid" | "rrf";
  /**
   * Ingestion granularity:
   * - "turn": each conversation turn stored as a separate memory (default)
   * - "session": entire session concatenated into one memory
   * - "chunk": session split into overlapping chunks with temporal metadata
   * - "extract": rules-based fact extraction from each turn + chunked sessions
   * - "turn-context": each turn stored with surrounding context window (best for QA benchmarks)
   * - "dual": sessions for broad context + individual turns for precise matching
   * - "llm-extract": LLM-based fact extraction per turn + chunked sessions (mirrors OpenClaw pipeline)
   */
  ingestMode?: "turn" | "session" | "chunk" | "extract" | "turn-context" | "dual" | "llm-extract";
  /**
   * LLM extraction function for "llm-extract" mode.
   * Takes conversation text, returns extracted facts with tags.
   */
  llmExtractFn?: (text: string) => Promise<Array<{ content: string; tags: string[] }>>;
  /**
   * Entity extraction function. When provided, entities are stored in memory metadata.
   */
  entityExtractFn?: (text: string) => string[];
  /** Chunk size in characters for "chunk" mode. Default: 800. */
  chunkSize?: number;
  /** Chunk overlap in characters for "chunk" mode. Default: 200. */
  chunkOverlap?: number;
  /**
   * Reranking function. Called after initial retrieval with the query and results.
   * Return reordered results. Used for cross-encoder or LLM-based reranking.
   */
  rerankFn?: (query: string, results: QueryExecution["results"]) => Promise<QueryExecution["results"]>;
  /**
   * Chunk enrichment function (Sliding Window Chunk Enrichment).
   * When provided, each chunk is processed by an LLM using surrounding context.
   * Applied in "chunk", "extract", and "llm-extract" modes.
   */
  enrichFn?: ChunkEnrichFn;
  /** Number of neighboring chunks on each side for enrichment context. Default: 1. */
  enrichWindowSize?: number;
  /**
   * How the enrichment LLM processes each chunk.
   * - "augment" (default): extract metadata header, prepend to original chunk,
   *   embed original text. Preserves query-chunk alignment.
   * - "rewrite": rewrite the entire chunk to be self-contained, embed the
   *   rewritten text. Better for structured documents, risky for conversations.
   */
  enrichMode?: "augment" | "rewrite";
  /**
   * Enable Latent Semantic Bridging. When true (and enrichFn is provided),
   * stores a second memory entry per chunk embedded on the metadata/inferred
   * meaning. Results are deduplicated by source chunk before returning.
   */
  latentBridging?: boolean;
  /**
   * Adaptive Query Expansion function.
   * When provided, generates N semantically diverse query reformulations,
   * searches each in parallel, and merges results via RRF.
   */
  queryExpandFn?: QueryExpandFn;
}

/**
 * Benchmark adapter for db0 — wraps a db0 backend for evaluation.
 */
export class Db0Adapter implements MemoryAdapter {
  readonly name = "db0";

  private opts: Db0AdapterOptions;
  private backend: Db0Backend | null = null;
  private agentId: string;
  private userId: string;
  private extractor: RulesExtractionStrategy;

  constructor(opts: Db0AdapterOptions) {
    this.opts = opts;
    this.agentId = opts.agentId ?? "bench-agent";
    this.userId = opts.userId ?? "bench-user";
    this.extractor = new RulesExtractionStrategy();
  }

  async setup(): Promise<void> {
    this.backend = await this.opts.createBackend();
  }

  async ingest(session: ConversationSession): Promise<void> {
    if (!this.backend) throw new Error("Adapter not initialized. Call setup() first.");

    const mode = this.opts.ingestMode ?? "turn";
    const dateStr = session.metadata?.dateTime as string | undefined;
    const datePrefix = dateStr ? `[${dateStr}] ` : "";

    if (mode === "session") {
      await this.ingestSession(session, datePrefix);
    } else if (mode === "chunk") {
      await this.ingestChunked(session, datePrefix);
    } else if (mode === "extract") {
      await this.ingestExtracted(session, datePrefix);
    } else if (mode === "turn-context") {
      await this.ingestTurnContext(session, datePrefix);
    } else if (mode === "dual") {
      await this.ingestSession(session, datePrefix);
      await this.ingestTurns(session, datePrefix);
    } else if (mode === "llm-extract") {
      await this.ingestLlmExtracted(session, datePrefix);
    } else {
      await this.ingestTurns(session, datePrefix);
    }
  }

  /** Turn-level: each turn stored as a separate memory. */
  private async ingestTurns(session: ConversationSession, datePrefix: string): Promise<void> {
    for (const turn of session.turns) {
      const text = `${datePrefix}${turn.speaker ?? turn.role}: ${turn.content}`;
      const embedding = await this.opts.embeddingFn(text);
      await this.backend!.memoryWrite(this.agentId, session.id, this.userId, {
        content: text,
        scope: "user",
        embedding,
        tags: [turn.role, `turn-${turn.turnIndex}`],
        metadata: {
          sessionId: session.id,
          role: turn.role,
          turnIndex: turn.turnIndex,
          ...(turn.speaker ? { speaker: turn.speaker } : {}),
        },
      });
    }
  }

  /** Session-level: entire session concatenated into one memory. */
  private async ingestSession(session: ConversationSession, datePrefix: string): Promise<void> {
    const text = datePrefix + session.turns
      .map((t) => `${t.speaker ?? t.role}: ${t.content}`)
      .join("\n");
    const embedding = await this.opts.embeddingFn(text.slice(0, 2000));
    await this.backend!.memoryWrite(this.agentId, session.id, this.userId, {
      content: text,
      scope: "user",
      embedding,
      tags: ["session-document"],
      metadata: { sessionId: session.id, turnCount: session.turns.length },
    });
  }

  /**
   * Chunked: session split into overlapping chunks with temporal metadata.
   * Each chunk gets date context and speaker attribution.
   */
  private async ingestChunked(session: ConversationSession, datePrefix: string): Promise<void> {
    const fullText = session.turns
      .map((t) => `${t.speaker ?? t.role}: ${t.content}`)
      .join("\n");

    // Prepend date to the full text so chunks inherit temporal context
    const textWithDate = datePrefix ? `Date: ${datePrefix.replace(/[\[\]]/g, "").trim()}\n\n${fullText}` : fullText;

    const originalChunks = chunkText(textWithDate, {
      chunkSize: this.opts.chunkSize ?? 800,
      chunkOverlap: this.opts.chunkOverlap ?? 200,
    });

    // Sliding Window Chunk Enrichment
    const enrichMode = this.opts.enrichMode ?? "augment";
    let enrichedOutputs: string[] | null = null;
    if (this.opts.enrichFn) {
      enrichedOutputs = await enrichChunks(originalChunks, this.opts.enrichFn, this.opts.enrichWindowSize ?? 1);
    }

    for (let i = 0; i < originalChunks.length; i++) {
      let content: string;
      let embedding: Float32Array;

      if (enrichedOutputs && enrichMode === "rewrite") {
        // Rewrite mode: store rewritten text, embed rewritten text.
        // Works best when query side is also LLM-normalized (via query expansion).
        content = enrichedOutputs[i];
        embedding = await this.opts.embeddingFn(enrichedOutputs[i]);
      } else if (enrichedOutputs && enrichMode === "augment") {
        // Augment mode: prepend metadata header, embed ORIGINAL text.
        // Preserves query-chunk alignment in embedding space.
        content = `[Context: ${enrichedOutputs[i]}]\n\n${originalChunks[i]}`;
        embedding = await this.opts.embeddingFn(originalChunks[i]);
      } else {
        content = originalChunks[i];
        embedding = await this.opts.embeddingFn(originalChunks[i]);
      }

      const baseMeta = {
        sessionId: session.id,
        chunkIndex: i,
        totalChunks: originalChunks.length,
        ...(session.metadata?.dateTime ? { dateTime: session.metadata.dateTime } : {}),
      };

      await this.backend!.memoryWrite(this.agentId, session.id, this.userId, {
        content,
        scope: "user",
        embedding,
        tags: ["chunk", `chunk-${i}`],
        metadata: baseMeta,
      });

      // Latent Semantic Bridging: store a second entry embedded on
      // the inferred meaning (enrichment output). Catches conceptual queries
      // that don't match the literal text. Content is the same so the answer
      // generator has full context; only the embedding differs.
      if (this.opts.latentBridging && enrichedOutputs?.[i]?.trim()) {
        const inferredEmbedding = await this.opts.embeddingFn(enrichedOutputs[i]);
        await this.backend!.memoryWrite(this.agentId, session.id, this.userId, {
          content, // same content as primary entry
          scope: "user",
          embedding: inferredEmbedding,
          tags: ["inferred", `chunk-${i}`],
          metadata: { ...baseMeta, source: "latent-semantic" },
        });
      }
    }
  }

  /**
   * Turn-context: each turn stored with a surrounding context window.
   * Combines per-turn precision with enough context for multi-hop reasoning.
   * Each memory contains the target turn + N surrounding turns for context.
   */
  private async ingestTurnContext(session: ConversationSession, datePrefix: string): Promise<void> {
    const contextWindow = 3; // turns before and after
    const turns = session.turns;

    for (let i = 0; i < turns.length; i++) {
      const start = Math.max(0, i - contextWindow);
      const end = Math.min(turns.length, i + contextWindow + 1);

      const contextTurns = turns.slice(start, end);
      const text = (datePrefix ? `Date: ${datePrefix.replace(/[\[\]]/g, "").trim()}\n\n` : "") +
        contextTurns.map((t) => `${t.speaker ?? t.role}: ${t.content}`).join("\n");

      // Embed the target turn (more precise match) not the full context
      const targetText = `${turns[i].speaker ?? turns[i].role}: ${turns[i].content}`;
      const embedding = await this.opts.embeddingFn(targetText);

      await this.backend!.memoryWrite(this.agentId, session.id, this.userId, {
        content: text,
        scope: "user",
        embedding,
        tags: ["turn-context", `turn-${i}`],
        metadata: {
          sessionId: session.id,
          turnIndex: i,
          speaker: turns[i].speaker ?? turns[i].role,
          ...(session.metadata?.dateTime ? { dateTime: session.metadata.dateTime } : {}),
        },
      });
    }
  }

  /**
   * LLM-extract: LLM-based fact extraction per turn + chunked sessions.
   * Mirrors OpenClaw's Tier 1 + Tier 2 extraction pipeline.
   */
  private async ingestLlmExtracted(session: ConversationSession, datePrefix: string): Promise<void> {
    if (!this.opts.llmExtractFn) {
      throw new Error("llm-extract mode requires llmExtractFn option");
    }

    // Layer 1: LLM-based fact extraction from each turn
    for (const turn of session.turns) {
      const text = `${datePrefix}${turn.speaker ?? turn.role}: ${turn.content}`;
      const facts = await this.opts.llmExtractFn(text);

      for (const fact of facts) {
        const embedding = await this.opts.embeddingFn(fact.content);
        const entities = this.opts.entityExtractFn?.(fact.content) ?? [];
        await this.backend!.memoryWrite(this.agentId, session.id, this.userId, {
          content: fact.content,
          scope: "user",
          embedding,
          tags: [...fact.tags, "llm-extracted"],
          metadata: {
            sessionId: session.id,
            source: "llm-extraction",
            speaker: turn.speaker ?? turn.role,
            ...(entities.length > 0 ? { entities } : {}),
            ...(session.metadata?.dateTime ? { dateTime: session.metadata.dateTime } : {}),
          },
        });
      }
    }

    // Layer 2: Chunked session context for broad retrieval
    await this.ingestChunked(session, datePrefix);
  }

  /**
   * Extract: rules-based fact extraction from turns + chunked session context.
   * Dual-layer: extracted facts for precise recall + chunks for broad context.
   */
  private async ingestExtracted(session: ConversationSession, datePrefix: string): Promise<void> {
    // Layer 1: Extract facts from each turn using rules engine
    for (const turn of session.turns) {
      const text = `${datePrefix}${turn.speaker ?? turn.role}: ${turn.content}`;
      const facts = this.extractor.extract(text);

      for (const fact of facts) {
        const embedding = await this.opts.embeddingFn(fact.content);
        await this.backend!.memoryWrite(this.agentId, session.id, this.userId, {
          content: fact.content,
          scope: "user",
          embedding,
          tags: [...fact.tags, "extracted-fact"],
          metadata: {
            sessionId: session.id,
            source: "rules-extraction",
            speaker: turn.speaker ?? turn.role,
            ...(session.metadata?.dateTime ? { dateTime: session.metadata.dateTime } : {}),
          },
        });
      }
    }

    // Layer 2: Also store chunked session context for broad retrieval
    await this.ingestChunked(session, datePrefix);
  }

  async query(queryText: string, limit = 10): Promise<QueryExecution> {
    if (!this.backend) throw new Error("Adapter not initialized. Call setup() first.");

    const start = performance.now();
    const fetchLimit = this.opts.rerankFn ? limit * 3 : limit;

    let mapped: QueryExecution["results"];

    if (this.opts.queryExpandFn) {
      // Adaptive Query Expansion: generate reformulations, search each, merge via RRF
      mapped = await this.expandedQuery(queryText, fetchLimit);
    } else {
      // Standard single-query path
      const embedding = await this.opts.embeddingFn(queryText);
      const results = await this.backend.memorySearch(
        this.agentId, null, this.userId,
        {
          embedding,
          scope: ["session", "user", "agent"],
          limit: fetchLimit,
          minScore: this.opts.minScore ?? 0.3,
          scoring: this.opts.scoring ?? "hybrid",
        },
      );
      mapped = results.map((r) => ({
        id: r.id,
        content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
        score: r.score,
        metadata: r.metadata ?? {},
      }));
    }

    // Latent Semantic Bridging deduplication: when multiple entries share
    // the same source chunk (chunkIndex + sessionId), keep only the highest-scoring one.
    // This prevents the top-K dilution problem caused by storing two embeddings per chunk.
    if (this.opts.latentBridging) {
      mapped = this.deduplicateByChunk(mapped);
    }

    // Apply reranking if configured
    if (this.opts.rerankFn && mapped.length > 0) {
      const reranked = await this.opts.rerankFn(queryText, mapped);
      mapped = reranked.slice(0, limit).map((r) => ({
        id: r.id,
        content: r.content,
        score: r.score,
        metadata: r.metadata ?? {},
      }));
    } else {
      mapped = mapped.slice(0, limit);
    }

    const latencyMs = performance.now() - start;

    return {
      queryId: "",
      query: queryText,
      results: mapped,
      latencyMs,
    };
  }

  /**
   * Adaptive Query Expansion: generate N reformulations, search each in parallel,
   * merge results via Reciprocal Rank Fusion.
   */
  private async expandedQuery(
    queryText: string,
    limit: number,
  ): Promise<QueryExecution["results"]> {
    const reformulations = await this.opts.queryExpandFn!(queryText);
    const allQueries = [queryText, ...reformulations];

    // Embed all queries in parallel
    const embeddings = await Promise.all(
      allQueries.map((q) => this.opts.embeddingFn(q)),
    );

    // Search all in parallel
    const searchResults = await Promise.all(
      embeddings.map((embedding) =>
        this.backend!.memorySearch(this.agentId, null, this.userId, {
          embedding,
          scope: ["session", "user", "agent"],
          limit,
          minScore: this.opts.minScore ?? 0.3,
          scoring: this.opts.scoring ?? "hybrid",
        }),
      ),
    );

    // Merge via RRF
    const rankedLists = searchResults.map((results) =>
      results.map((r) => ({
        id: r.id,
        content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
        score: r.score,
        metadata: r.metadata ?? {},
      })),
    );

    const rrfScores = rrfMerge(rankedLists, (item) => item.id);

    // Build deduplicated results ordered by RRF score
    const contentMap = new Map<string, QueryExecution["results"][0]>();
    for (const list of rankedLists) {
      for (const item of list) {
        if (!contentMap.has(item.id)) contentMap.set(item.id, item);
      }
    }

    const merged: QueryExecution["results"] = [];
    for (const [id, score] of rrfScores) {
      const item = contentMap.get(id);
      if (item) merged.push({ ...item, score });
    }

    return merged;
  }

  /**
   * Deduplicate results by source chunk. When Latent Semantic Bridging is enabled,
   * the same chunk content may appear twice (original-embedded + metadata-embedded).
   * Keep only the highest-scoring entry per (sessionId, chunkIndex) pair.
   */
  private deduplicateByChunk(results: QueryExecution["results"]): QueryExecution["results"] {
    const seen = new Map<string, QueryExecution["results"][0]>();

    for (const r of results) {
      const sessionId = r.metadata?.sessionId as string | undefined;
      const chunkIndex = r.metadata?.chunkIndex as number | undefined;

      // If we can't identify the source chunk, keep the result as-is
      if (sessionId === undefined || chunkIndex === undefined) {
        seen.set(r.id, r);
        continue;
      }

      const key = `${sessionId}:${chunkIndex}`;
      const existing = seen.get(key);
      if (!existing || r.score > existing.score) {
        // Remove old lower-scoring entry if it was keyed by chunk
        if (existing) {
          seen.delete(key);
        }
        seen.set(key, r);
      }
    }

    // Preserve score ordering
    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }

  async reset(): Promise<void> {
    if (this.backend) {
      this.backend.close();
    }
    this.backend = await this.opts.createBackend();
  }

  async teardown(): Promise<void> {
    if (this.backend) {
      this.backend.close();
      this.backend = null;
    }
  }
}
