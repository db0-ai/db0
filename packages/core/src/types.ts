// === Scope ===
export type MemoryScope = "task" | "session" | "user" | "agent";

// === Memory Status ===
export type MemoryStatus = "active" | "superseded";

// === Memory Content ===
export type MemoryContent = string | Record<string, unknown>;

// === Provenance ===
/** How this memory was originally produced. */
export type MemorySourceType =
  | "user_statement"
  | "inference"
  | "file"
  | "tool_result"
  | "compaction";

/** Which extraction pathway created this memory. */
export type MemoryExtractionMethod =
  | "rules"
  | "llm"
  | "manual"
  | "preserve"
  | "reconcile"
  | "consolidate"
  | "fallback";

// === Memory ===
export interface MemoryWriteOpts {
  content: MemoryContent;
  scope: MemoryScope;
  embedding: Float32Array;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** ID of the memory this supersedes. The old memory will be marked as superseded. */
  supersedes?: string;
  /** Expected version of the superseded memory. Throws VersionConflictError on mismatch. */
  expectedVersion?: number;
  /** One-line summary (L0). Auto-generated from first sentence if omitted. */
  summary?: string;
  /** How this memory was produced (user statement, inference, file, etc.). */
  sourceType?: MemorySourceType;
  /** Which extraction method created this memory. */
  extractionMethod?: MemoryExtractionMethod;
  /** Confidence score (0.0–1.0). Explicit facts default to 1.0; fallback extractions are lower. */
  confidence?: number;
}

export interface MemoryEntry {
  id: string;
  agentId: string;
  sessionId: string | null;
  userId: string | null;
  content: MemoryContent;
  scope: MemoryScope;
  embedding: Float32Array;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  accessCount: number;
  /** ID of the memory this entry supersedes, or null. */
  supersedes: string | null;
  /** Whether this memory is active or has been superseded by a newer one. */
  status: MemoryStatus;
  /** Monotonic version for optimistic concurrency. Starts at 1. */
  version: number;
  /** One-line summary (L0). Null for legacy entries not yet backfilled. */
  summary: string | null;
  /** How this memory was produced. Null for legacy entries. */
  sourceType: MemorySourceType | null;
  /** Which extraction method created this memory. Null for legacy entries. */
  extractionMethod: MemoryExtractionMethod | null;
  /** Confidence score (0.0–1.0). Explicit facts = 1.0; fallback extractions are lower. Null for legacy entries. */
  confidence: number | null;
  /** When this memory stopped being valid (superseded). Null = still valid. */
  validTo: string | null;
}

export interface MemorySearchOpts {
  /** Embedding vector for semantic search. Optional when using tag/metadata/queryText filters. */
  embedding?: Float32Array;
  scope?: MemoryScope | MemoryScope[];
  limit?: number;
  minScore?: number;
  /** Filter by tags (AND — all must match). */
  tags?: string[];
  /** Only return memories created after this ISO timestamp. */
  since?: string;
  /** ISO timestamp — only return memories created before this time. */
  until?: string;
  /** Filter by metadata key-value pairs (AND — all must match). */
  metadata?: Record<string, unknown>;
  /**
   * Plain text query for full-text search.
   * Can be combined with embedding for RRF fusion.
   */
  queryText?: string;
  /**
   * Scoring mode:
   * - "similarity" (default): pure cosine similarity
   * - "hybrid": weighted blend of similarity, recency, popularity
   * - "rrf": Reciprocal Rank Fusion of vector search + full-text search
   */
  scoring?: "similarity" | "hybrid" | "rrf";
  /**
   * Custom weights for hybrid scoring. Must sum to 1.0.
   * Default: { similarity: 0.7, recency: 0.2, popularity: 0.1 }
   */
  hybridWeights?: {
    similarity?: number;
    recency?: number;
    popularity?: number;
  };
  /**
   * Half-life for recency decay in days (hybrid mode).
   * After this many days, recency score drops to 50%.
   * Default: 7 (one week).
   */
  decayHalfLifeDays?: number;
  /** Include superseded memories? Default: false (only active). */
  includeSuperseded?: boolean;
  /** Enable graph expansion — fetch 1-hop connected memories via edges. */
  graphExpand?: {
    /** Max additional memories to add from graph traversal. Default: 5. */
    maxExpand?: number;
    /** Edge types to traverse. Default: all types. */
    edgeTypes?: MemoryEdgeType[];
    /** Score boost for graph-expanded results (0-1). Default: 0.1. */
    boostFactor?: number;
  };
  /**
   * Optional reranking function applied after initial retrieval.
   * Receives the raw query text and candidate results; returns reordered results.
   * Useful for cross-encoder reranking (e.g., Jina, Voyage, Cohere).
   */
  rerankFn?: (query: string, results: MemorySearchResult[]) => Promise<MemorySearchResult[]> | MemorySearchResult[];
}

export interface MemorySearchResult extends MemoryEntry {
  /** Final composite score. */
  score: number;
  /** Raw cosine similarity score (only present when embedding was provided). */
  similarityScore?: number;
  /** Recency score 0-1 (only present in hybrid mode). */
  recencyScore?: number;
  /** Popularity score 0-1 (only present in hybrid mode). */
  popularityScore?: number;
  /** Full-text search score 0-1 (only present when queryText was provided). */
  ftsScore?: number;
}

// === Memory Edges (relationships) ===
export type MemoryEdgeType =
  | "related"
  | "derived"
  | "contradicts"
  | "supports"
  | "supersedes";

export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: MemoryEdgeType;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryEdgeWriteOpts {
  sourceId: string;
  targetId: string;
  edgeType: MemoryEdgeType;
  metadata?: Record<string, unknown>;
}

// === State ===
export interface StateCheckpointOpts {
  step: number;
  label?: string;
  metadata?: Record<string, unknown>;
  /** Create a branch from an existing checkpoint. */
  parentCheckpointId?: string;
}

export interface StateCheckpoint {
  id: string;
  agentId: string;
  sessionId: string;
  step: number;
  label: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  /** Parent checkpoint ID if this was branched. */
  parentCheckpointId: string | null;
}

// === Log ===
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogAppendOpts {
  event: string;
  level: LogLevel;
  data?: Record<string, unknown>;
}

export interface LogEntry {
  id: string;
  agentId: string;
  sessionId: string;
  event: string;
  level: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// === Backend ===
export interface Db0Backend {
  memoryWrite(
    agentId: string,
    sessionId: string | null,
    userId: string | null,
    opts: MemoryWriteOpts,
  ): Promise<MemoryEntry>;
  memorySearch(
    agentId: string,
    sessionId: string | null,
    userId: string | null,
    opts: MemorySearchOpts,
  ): Promise<MemorySearchResult[]>;
  memoryList(agentId: string, scope?: MemoryScope): Promise<MemoryEntry[]>;
  memoryDelete(id: string): Promise<void>;
  memoryGet(id: string): Promise<MemoryEntry | null>;

  /** Add a typed edge between two memories. */
  memoryAddEdge(opts: MemoryEdgeWriteOpts): Promise<MemoryEdge>;
  /** Get all edges from or to a memory. */
  memoryGetEdges(memoryId: string): Promise<MemoryEdge[]>;
  /** Remove an edge. */
  memoryDeleteEdge(edgeId: string): Promise<void>;

  stateCheckpoint(
    agentId: string,
    sessionId: string,
    opts: StateCheckpointOpts,
  ): Promise<StateCheckpoint>;
  stateRestore(
    agentId: string,
    sessionId: string,
  ): Promise<StateCheckpoint | null>;
  stateList(
    agentId: string,
    sessionId: string,
  ): Promise<StateCheckpoint[]>;
  /** Get a specific checkpoint by ID. */
  stateGetCheckpoint(id: string): Promise<StateCheckpoint | null>;

  logAppend(
    agentId: string,
    sessionId: string,
    opts: LogAppendOpts,
  ): Promise<LogEntry>;
  logQuery(
    agentId: string,
    sessionId?: string,
    limit?: number,
  ): Promise<LogEntry[]>;

  /** Read a value from the db0_meta key-value store. */
  metaGet(key: string): Promise<string | null>;
  /** Write a value to the db0_meta key-value store (upsert). */
  metaSet(key: string, value: string): Promise<void>;

  close(): void;
}

// === Extraction ===
export interface ExtractionResult {
  content: string;
  scope: MemoryScope;
  tags: string[];
  /** How this fact was produced. Set by the extraction strategy. */
  sourceType?: MemorySourceType;
  /** Which extraction method produced this. Set by the extraction strategy. */
  extractionMethod?: MemoryExtractionMethod;
  /** Confidence score (0.0–1.0). Omit for full-confidence extractions. */
  confidence?: number;
}

export interface ExtractionStrategy {
  extract(content: string): ExtractionResult[] | Promise<ExtractionResult[]>;
}

export interface LlmExtractionConfig {
  /** Async function that calls your LLM and returns extracted facts. */
  extractFn: (text: string) => Promise<ExtractionResult[]>;
}

// === Profile (tunable workload knobs) ===

/**
 * A Db0Profile bundles all tunable knobs for the memory engine into a
 * single configuration object — analogous to `postgresql.conf` for Postgres
 * or a MySQL tuning template. Each plugin or use case declares a default
 * profile, and users can override individual knobs without understanding
 * the full parameter space.
 *
 * ## Architecture
 *
 * The profile system has three layers (highest priority wins):
 *
 * 1. **Engine defaults** — hardcoded fallbacks in the engine code
 * 2. **Profile preset** — a named bundle from `PROFILES` or a custom object
 * 3. **Explicit overrides** — individual fields set by the user/plugin
 *
 * Use `mergeProfiles(base, overrides)` to compose profiles programmatically.
 *
 * ## Choosing a Profile
 *
 * Ask these questions about your workload:
 *
 * | Question                                    | Low                        | High                        |
 * |---------------------------------------------|----------------------------|-----------------------------|
 * | How fast does content become irrelevant?     | Long decay, low recency wt | Short decay, high recency   |
 * | How structured is the input?                 | Enrichment helps           | Enrichment unnecessary      |
 * | How precise are user queries?                | Query expansion, low min   | High minScore, no expansion |
 * | How large is the memory corpus?              | Larger topK affordable     | Smaller topK for focus      |
 * | Are memories interconnected?                 | Enable graph expansion     | Disable graph expansion     |
 * | Is latency critical?                         | Disable expansion/enrich   | Can afford LLM calls        |
 *
 * Built-in presets (see `profiles.ts` for full definitions):
 *
 * - **`conversational`** — chatbots, support agents, social companions
 * - **`knowledge-base`** — document retrieval, wikis, research assistants
 * - **`coding-assistant`** — IDEs, code review tools, dev-facing agents
 * - **`agent-context`** — agent context engines (e.g., OpenClaw) that blend
 *   conversational recall with file/document knowledge
 * - **`curated-memory`** — explicitly authored memory files (e.g., Claude Code's
 *   `~/.claude/memory/` system) where content is human-curated and long-lived
 * - **`high-recall`** — benchmarks, research, exhaustive retrieval
 * - **`minimal`** — testing, resource-constrained environments, zero LLM calls
 *
 * All fields are optional — unset values inherit from the base profile
 * or fall back to engine defaults.
 */
export interface Db0Profile {
  /** Human-readable name for this profile (e.g., "conversational", "knowledge-base"). */
  name?: string;
  /** Optional description of the workload this profile is tuned for. */
  description?: string;

  /**
   * Ingestion settings — how content is broken up and stored.
   *
   * The ingestion pipeline controls the granularity and richness of stored
   * memories. The right settings depend on input structure:
   *
   * - **Conversations** (chat logs, support tickets): `session` or `turn-context`
   *   preserves conversational flow and speaker attribution.
   * - **Documents** (articles, READMEs, knowledge files): `chunk` mode with
   *   overlap ensures semantic continuity across chunk boundaries.
   * - **Curated facts** (user-authored memory files): `chunk` mode without
   *   enrichment — the content is already well-structured.
   */
  ingest?: {
    /**
     * How content is segmented before storage.
     *
     * - `"session"` — store entire conversation sessions as single memories.
     *   Best for preserving conversational context and temporal flow.
     *   Trade-off: large memories may dilute retrieval precision.
     *
     * - `"chunk"` — split content into fixed-size overlapping chunks.
     *   Best for documents, articles, and large text corpora.
     *   Trade-off: loses conversational structure; chunks may split
     *   mid-thought (mitigated by overlap and enrichment).
     *
     * - `"turn-context"` — store each conversation turn with a window of
     *   surrounding turns as context. Balances per-turn precision with
     *   enough context for multi-hop reasoning.
     */
    mode?: "session" | "chunk" | "turn-context";

    /**
     * Target chunk size in characters (only for `chunk` and `turn-context` modes).
     *
     * Smaller chunks (800-1200) → more precise retrieval, more memories stored.
     * Larger chunks (1600-2400) → more context per result, fewer embeddings needed.
     *
     * Rule of thumb: ~4 characters per token, so 1600 chars ≈ 400 tokens.
     * Most embedding models have a 512-token input limit.
     */
    chunkSize?: number;

    /**
     * Overlap between consecutive chunks in characters.
     *
     * Overlap prevents information loss at chunk boundaries. Semantic ideas
     * that span a boundary appear in both chunks, improving retrieval.
     *
     * Typical: 15-25% of chunkSize. Higher overlap → more redundancy but
     * better boundary coverage. Setting to 0 risks losing cross-boundary context.
     */
    chunkOverlap?: number;

    /**
     * Enable chunk enrichment via LLM.
     *
     * When enabled, each chunk is processed by an LLM to add contextual
     * information that the chunk loses when extracted from its source.
     * The enrichment mode (`enrichMode`) controls how this is done.
     *
     * Trade-offs:
     * - Requires an LLM call per chunk during ingestion (increased cost/latency)
     * - Significant improvement for messy conversational data (+11.5pp on LoCoMo)
     * - Minimal benefit for already-structured content (curated memory files)
     *
     * Best for: conversations, meeting transcripts, unstructured text.
     * Skip for: curated knowledge files, structured documents, code.
     */
    enrich?: boolean;

    /**
     * How the enrichment LLM processes each chunk.
     *
     * - `"augment"` (default) — extracts a metadata header (people, topics,
     *   dates, key facts) and **prepends** it to the original chunk text as a
     *   `[Context: ...]` block. The original text is preserved verbatim.
     *   The embedding is computed from the **original** text (not the header),
     *   avoiding semantic drift between stored embeddings and query embeddings.
     *
     *   Best for: conversations, meeting transcripts, multi-party chat.
     *   Benchmark: +11.5pp on LoCoMo (57.8% → 69.3%).
     *
     * - `"rewrite"` — the LLM **rewrites** the entire chunk to be self-contained,
     *   resolving pronouns, co-references, and temporal references inline.
     *   The embedding is computed from the **rewritten** text.
     *
     *   WARNING: Rewrite mode works best when the query side is also normalized
     *   (via query expansion or similar rewriting). Without query-side normalization,
     *   the rewritten embeddings live in a different region of embedding space
     *   than raw queries, causing **semantic drift** and retrieval degradation.
     *
     *   Best for: structured documents (technical docs, wiki articles, manuals)
     *   where the input has few speakers and simple pronoun chains.
     *   Avoid for: messy conversations — destroys speaker attribution and nuance.
     *   Benchmark: -29.7pp on LoCoMo (57.8% → 28.1%) due to semantic drift.
     */
    enrichMode?: "augment" | "rewrite";

    /**
     * Number of neighboring chunks on each side used as context for enrichment.
     *
     * The enrichment LLM sees the target chunk plus `enrichWindowSize` chunks
     * before and after it, enabling it to resolve references across chunk boundaries.
     *
     * - `1` (default) — sees 1 chunk before + 1 after. Good balance of context vs cost.
     * - `2` — sees 2 chunks each side. Better for long-range references, ~2x more tokens.
     * - `0` — no context window (each chunk enriched in isolation). Rarely useful.
     */
    enrichWindowSize?: number;

    /**
     * Enable Latent Semantic Bridging.
     *
     * When enabled (and enrichment is also enabled), a second memory entry is
     * stored per chunk, embedded on the **metadata/inferred meaning** rather
     * than the literal text. This catches conceptual queries that don't match
     * the literal text — e.g., "health discussions" matching a chunk about
     * "LGBTQ support group meeting". Both entries share the same content
     * (original text + metadata header), but have different embeddings.
     *
     * Results are **deduplicated by source chunk** before returning — if both
     * the original-embedded and metadata-embedded entries for the same chunk
     * appear in results, only the higher-scoring one is kept. This prevents
     * the top-K dilution problem that occurs without deduplication.
     *
     * Trade-offs:
     * - Doubles the number of embeddings computed during ingestion
     * - Doubles storage requirements (two entries per chunk)
     * - Improves recall for conceptual/abstract queries on structured content
     * - Without deduplication, causes top-K dilution (-10pp on LoCoMo)
     * - With deduplication, still -10pp on LoCoMo conversational benchmark
     *   because metadata embeddings are too generic for conversations — multiple
     *   chunks share similar inferred topics, pulling in wrong chunks
     *
     * Best for: knowledge bases, curated memory files, large document corpora
     * where chunks are semantically distinct and queries range from precise
     * to conceptual.
     * Skip for: conversations, chat logs, latency-sensitive agents, code queries.
     */
    latentBridging?: boolean;
  };

  /**
   * Retrieval settings — how memories are searched, scored, and ranked.
   *
   * These knobs control the precision/recall trade-off at query time.
   * The right balance depends on your workload:
   *
   * - **High-precision workloads** (coding, factual QA): high similarity weight,
   *   high minScore, small topK. Every result must be relevant.
   * - **High-recall workloads** (research, brainstorming): low minScore, large
   *   topK, query expansion. Missing a relevant result is worse than noise.
   * - **Conversational workloads** (chat agents): moderate settings with
   *   significant recency weight — recent context matters more.
   */
  retrieval?: {
    /**
     * Maximum number of memories returned per search.
     *
     * This directly controls how much context the answer generator sees.
     * Too low → misses relevant memories. Too high → dilutes signal with noise
     * and consumes more of the LLM's context window.
     *
     * Guidelines:
     * - Small corpus (<100 memories): 5-8
     * - Medium corpus (100-1000): 8-12
     * - Large corpus (1000+): 10-15
     * - With query expansion: can use lower topK since expansion improves recall
     */
    topK?: number;

    /**
     * Minimum composite score threshold (0.0 - 1.0).
     *
     * Memories scoring below this are excluded from results. Acts as a
     * noise filter — higher values mean stricter relevance requirements.
     *
     * - 0.25-0.35 — permissive (high recall, more noise)
     * - 0.40-0.50 — balanced
     * - 0.50+ — strict (high precision, may miss edge cases)
     *
     * Note: the score meaning depends on the scoring mode (similarity vs hybrid).
     */
    minScore?: number;

    /**
     * How memories are scored and ranked.
     *
     * - `"similarity"` — pure cosine similarity between query and memory embeddings.
     *   Simple, fast, and effective when recency doesn't matter.
     *
     * - `"hybrid"` — weighted blend of similarity, recency, and popularity.
     *   Use when memory freshness or access frequency should influence ranking.
     *   Configure weights via `hybridWeights` and decay via `decayHalfLifeDays`.
     *
     * - `"rrf"` — Reciprocal Rank Fusion of vector search + full-text search.
     *   Combines semantic understanding (embeddings) with keyword matching (FTS).
     *   Requires `queryText` in search options. Best when users mix natural
     *   language queries with exact keyword searches.
     */
    scoring?: "similarity" | "hybrid" | "rrf";

    /**
     * Weights for hybrid scoring components (must sum to 1.0).
     *
     * The hybrid score is: `w_sim * similarity + w_rec * recency + w_pop * popularity`
     *
     * Tuning guide:
     * - **similarity** — how semantically close is this memory to the query?
     *   Higher weight = content relevance dominates. Good for precise queries.
     *   Range: 0.5-0.9 depending on workload.
     *
     * - **recency** — how recently was this memory created?
     *   Higher weight = newer memories rank higher. Good for chat/support where
     *   recent context matters most. Decays exponentially with `decayHalfLifeDays`.
     *   Range: 0.05-0.35 depending on how fast content becomes stale.
     *
     * - **popularity** — how often has this memory been accessed?
     *   Higher weight = frequently-retrieved memories rank higher. Acts as
     *   implicit relevance feedback — memories that keep being useful stay prominent.
     *   Range: 0.05-0.15 (usually a small signal).
     */
    hybridWeights?: {
      similarity?: number;
      recency?: number;
      popularity?: number;
    };

    /**
     * Half-life for the recency decay function, in days.
     *
     * Controls how quickly the recency score drops off. After `decayHalfLifeDays`,
     * a memory's recency score drops to 50%. After 2x, it drops to 25%, etc.
     *
     * The decay function is: `recency = 2^(-age_days / halfLife)`
     *
     * Tuning guide:
     * - 3-7 days — fast decay for real-time chat, support tickets, daily standups
     * - 14-30 days — moderate decay for project work, sprint-scoped context
     * - 30-90 days — slow decay for persistent knowledge, user preferences
     * - 90+ days — near-permanent; recency barely matters (use low recency weight instead)
     */
    decayHalfLifeDays?: number;

    /**
     * Enable adaptive query expansion.
     *
     * When enabled, the query is reformulated into 2-3 diverse variations by an LLM,
     * each is embedded and searched independently, and results are merged via
     * Reciprocal Rank Fusion (RRF). This catches memories that match the intent
     * but use different terminology than the original query.
     *
     * Trade-offs:
     * - Requires an LLM call + 2-3 extra embedding calls per query
     * - Adds 200-500ms latency depending on the LLM
     * - Improves recall for vague or conceptual queries
     * - Minimal benefit when queries are precise (code search, exact names)
     *
     * Best for: knowledge retrieval, research, open-ended questions.
     * Skip for: latency-sensitive agents, precise code queries.
     */
    queryExpansion?: boolean;

    /**
     * Graph-augmented retrieval — traverse memory edges to find related content.
     *
     * After the initial vector search, the engine traverses typed edges
     * (related, supports, contradicts, derived, supersedes) from top results
     * to discover connected memories that may not match the query directly
     * but provide important context.
     *
     * Example: querying "user's favorite color" might retrieve a memory about
     * "blue", and graph expansion finds a connected "contradicts" edge to an
     * older memory saying "red" — surfacing the fact that the preference changed.
     */
    graphExpand?: {
      /** Enable graph expansion. Default: true in most profiles. */
      enabled?: boolean;
      /**
       * Max additional memories to add from graph traversal.
       * These count toward the total results but are scored with a boost factor.
       * Higher values → more comprehensive context, but more noise.
       */
      maxExpand?: number;
      /**
       * Which edge types to traverse. Default: all types.
       * Restricting to specific types focuses expansion on certain relationships.
       * - "related" — general association
       * - "supports" — evidence/corroboration
       * - "contradicts" — conflicting information (important for fact updates)
       * - "derived" — summarized or distilled from source
       * - "supersedes" — newer version of the same fact
       */
      edgeTypes?: MemoryEdgeType[];
      /**
       * Score boost applied to graph-expanded results (0.0-1.0).
       * Graph results start with this score (or their own similarity if higher).
       * Lower values → graph results rank below direct hits.
       */
      boostFactor?: number;
    };
  };

  /**
   * Extraction settings — how facts are identified from raw content.
   *
   * Extraction is the process of identifying durable facts from conversation
   * turns or ingested content. db0 supports a tiered extraction pipeline:
   *
   * - **Tier 1 (per-turn)**: Runs on every ingested turn. Strategy controls
   *   whether this uses signal-word rules, LLM calls, or manual writes.
   * - **Tier 2 (batch)**: Accumulates turns and runs one LLM call at intervals.
   *   More efficient than per-turn LLM extraction, catches patterns across turns.
   */
  extraction?: {
    /**
     * Tier 1 extraction strategy.
     *
     * - `"rules"` (default) — zero-LLM extraction using signal words
     *   ("I learned", "remember that", "my name is"). Fast and free, but
     *   misses implicit facts. Good default for most workloads.
     *
     * - `"manual"` — no automatic extraction. The application calls
     *   `memory().write()` explicitly. Use when the application has its
     *   own fact extraction logic or curates memories externally.
     *
     * - `"llm"` — LLM-powered extraction on every turn. Most thorough but
     *   expensive. Requires `llm.extractFn` in the harness config.
     *   Consider tier 2 batch extraction as a more efficient alternative.
     */
    strategy?: "rules" | "manual" | "llm";

    /**
     * Tier 2: trigger batch extraction after this many assistant turns.
     *
     * Batch extraction accumulates turn content and runs a single LLM call
     * to extract facts across the batch. More cost-efficient than per-turn
     * LLM extraction and can identify patterns spanning multiple turns.
     *
     * Lower values → more frequent extraction, higher LLM cost.
     * Higher values → fewer LLM calls, risk of losing facts if session ends early.
     * Typical: 10-25 turns.
     */
    batchInterval?: number;

    /**
     * Max accumulated content characters before forcing a batch extraction,
     * regardless of turn count. Prevents unbounded buffer growth in long sessions.
     * Default: 50000 (~12.5k tokens).
     */
    maxBufferSize?: number;
  };

  /**
   * Context assembly settings — how the context() module packs and manages
   * memories for model consumption.
   *
   * These knobs control the `context().pack()` and `context().preserve()`
   * methods. Most behavior inherits from the `retrieval` and `extraction`
   * sections — only context-specific concerns live here.
   */
  context?: {
    /**
     * Token budget ratio for packed context (0.0-1.0).
     *
     * Expressed as a fraction of the model's context window. The actual
     * token budget passed to `pack()` is: `modelContextWindow * budgetRatio`.
     * Apps are responsible for computing the absolute budget from this ratio.
     *
     * Default: 0.15 (15% of context window for memory injection).
     */
    budgetRatio?: number;

    /**
     * Include relationship edges (contradicts, supports, etc.) in packed output.
     *
     * When enabled, pack() annotates each memory with its edges to other
     * memories in the result set, e.g., `{contradicts [3], supports [1]}`.
     * Helps the model understand relationships between recalled facts.
     *
     * Default: true.
     */
    includeEdges?: boolean;

    /**
     * Max items in pack() result. Overrides retrieval.topK for context assembly.
     * Use when the context budget is the real constraint (not result count).
     *
     * Default: falls back to retrieval.topK.
     */
    maxPackItems?: number;
  };

  /**
   * Reconciliation settings — background maintenance (tier 3).
   *
   * Reconciliation is a periodic background process that:
   * 1. **Promotes** high-access file-chunks to durable user-scoped memories
   * 2. **Merges** duplicate or near-duplicate memories
   * 3. **Cleans** stale contradiction edges
   *
   * Think of it as `VACUUM` for the memory engine — not required for
   * correctness, but improves quality over time.
   */
  reconciliation?: {
    /**
     * Minimum access count before a file-chunk is promoted to a durable memory.
     * Higher threshold → only the most-retrieved chunks get promoted.
     * Lower threshold → more aggressive promotion, larger memory corpus.
     */
    promotionThreshold?: number;
    /** Max items to process per reconcile() call. Limits CPU/IO per pass. */
    batchSize?: number;
    /** Auto-run reconciliation in afterTurn(). Default: false. */
    autoReconcile?: boolean;
    /**
     * Run reconciliation every N turns when autoReconcile is true.
     * Lower values → more frequent maintenance, more overhead.
     * Higher values → less overhead, slower convergence.
     */
    reconcileInterval?: number;
    /**
     * Min embedding similarity to cluster memories for LLM consolidation.
     * Only used when consolidateFn is configured on the harness.
     * Higher values → tighter clusters, fewer merges.
     * Default: 0.75.
     */
    consolidateThreshold?: number;
    /** Min memories per cluster to trigger LLM merge. Default: 2. */
    consolidateMinCluster?: number;
    /** Max clusters to process per reconcile() call. Default: 10. */
    consolidateMaxClusters?: number;
  };
}

/**
 * Deep-merge two profiles. `overrides` takes precedence over `base`.
 * Only merges plain objects — arrays and primitives from overrides replace base values.
 */
export function mergeProfiles(base: Db0Profile, overrides: Db0Profile): Db0Profile {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides) as Array<keyof Db0Profile>) {
    const baseVal = base[key];
    const overVal = overrides[key];
    if (
      overVal !== undefined &&
      typeof overVal === "object" &&
      !Array.isArray(overVal) &&
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      // One level deeper for nested config objects
      const merged: Record<string, unknown> = { ...(baseVal as Record<string, unknown>) };
      for (const [k, v] of Object.entries(overVal as Record<string, unknown>)) {
        if (
          v !== undefined &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          v !== null &&
          typeof merged[k] === "object" &&
          merged[k] !== null &&
          !Array.isArray(merged[k])
        ) {
          merged[k] = { ...(merged[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
        } else if (v !== undefined) {
          merged[k] = v;
        }
      }
      result[key] = merged;
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result as Db0Profile;
}

// === Embedding Function Types ===

/**
 * Embeds a single text string into a vector.
 * Provider-agnostic — implementations live in the apps layer.
 */
export type EmbeddingFn = (text: string) => Promise<Float32Array>;

/**
 * Embeds multiple texts in a single call for efficiency.
 * Provider-specific batch sizes are handled by the implementation:
 * - Gemini: 100/request
 * - OpenAI: 2048/request
 * - Ollama: sequential fallback
 * - Hash: instant (in-process)
 */
export type BatchEmbeddingFn = (texts: string[]) => Promise<Float32Array[]>;

// === Context Types ===

export interface ContextIngestOpts {
  scope: MemoryScope;
  tags?: string[];
  /** Pre-computed embedding. If omitted, computed via the harness embeddingFn. */
  embedding?: Float32Array;
  /** How this fact was produced. */
  sourceType?: MemorySourceType;
  /** Which extraction method produced this. */
  extractionMethod?: MemoryExtractionMethod;
  /** Confidence score (0.0–1.0). Omit for full-confidence facts. */
  confidence?: number;
}

export interface ContextIngestResult {
  /** True if the fact was a duplicate and was not stored. */
  deduped: boolean;
  /** True if a contradiction edge was created to an existing memory. */
  contradictionLinked: boolean;
  /** ID of the written memory, or null if deduped. */
  id: string | null;
}

export interface ContextPackOpts {
  /** Token budget for the packed output. Default: derived from profile. */
  tokenBudget?: number;
  /** Search scopes to include. Default: ["user", "agent"]. */
  scopes?: MemoryScope[];
  /** Max items to include. Default: profile's retrieval.topK. */
  maxItems?: number;
  /** Include relationship edges in output. Default: profile's context.includeEdges. */
  includeEdges?: boolean;
  /** Pre-computed query embedding. If omitted, computed via the harness embeddingFn. */
  embedding?: Float32Array;
  /** Minimum similarity score. Default: profile's retrieval.minScore. */
  minScore?: number;
}

export interface ContextPackResult {
  /** Formatted text ready for system prompt injection. */
  text: string;
  /** Number of memories included. */
  count: number;
  /** Estimated token count of the packed text. */
  estimatedTokens: number;
  /** The raw search results used. */
  memories: MemorySearchResult[];
}

export interface PreserveMessage {
  role: string;
  content: string;
}

export interface ContextPreserveOpts {
  /** Scope for preserved facts. Default: "user". */
  scope?: MemoryScope;
  /** Additional tags applied to all preserved facts. */
  tags?: string[];
}

export interface ContextPreserveResult {
  /** Number of facts extracted from messages. */
  extracted: number;
  /** Number of facts that were duplicates. */
  deduped: number;
  /** Number of contradiction edges created. */
  contradictions: number;
}

export interface ContextReconcileOpts {
  /** Min access count before a file-chunk is promoted. Default: profile's reconciliation.promotionThreshold. */
  promotionThreshold?: number;
  /** Max items to process per call. Default: profile's reconciliation.batchSize. */
  batchSize?: number;
}

export interface ContextReconcileResult {
  promoted: number;
  merged: number;
  contradictionsCleaned: number;
  /** Number of memory clusters merged via consolidateFn. 0 if consolidateFn not configured. */
  consolidated: number;
  /** Number of individual memories superseded by consolidation. */
  consolidatedMemories: number;
}

/** Function that merges a cluster of related memories into one. */
export type ConsolidateFn = (memories: Array<{
  content: string;
  scope: MemoryScope;
  tags: string[];
  createdAt: string;
}>) => Promise<{
  content: string;
  tags?: string[];
}>;

// === Harness Config ===
export interface HarnessConfig {
  agentId: string;
  sessionId: string;
  userId?: string;
  backend: Db0Backend;
  extraction?: {
    durableFacts?: "rules" | "manual" | "llm";
    llm?: LlmExtractionConfig;
  };
  /** Custom summarize function for L0 summaries. Falls back to first-sentence extraction. */
  summarizeFn?: (content: MemoryContent) => string | Promise<string>;
  /**
   * Workload profile — bundles tunable knobs for ingestion, retrieval,
   * extraction, and reconciliation. Use a built-in preset from `PROFILES`
   * or define a custom one. Individual knobs can be overridden elsewhere.
   */
  profile?: Db0Profile;
  /**
   * Embedding function for the context() module. If omitted, falls back
   * to hashEmbed (built-in, zero-dependency, low quality).
   */
  embeddingFn?: EmbeddingFn;
  /**
   * Batch embedding function for efficient bulk operations (preserve, migration).
   * If omitted, wraps embeddingFn sequentially.
   */
  batchEmbeddingFn?: BatchEmbeddingFn;
  /**
   * LLM function for memory consolidation. When provided, reconcile() clusters
   * semantically similar memories and calls this function to merge each cluster
   * into a single fact. Without it, reconcile() only does exact-match dedup.
   */
  consolidateFn?: ConsolidateFn;
}
