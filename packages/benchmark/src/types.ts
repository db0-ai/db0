// === Dataset Types ===

/** A single conversation turn in a dataset. */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  /** ISO timestamp for temporal ordering. */
  timestamp?: string;
  /** Turn index within the conversation. */
  turnIndex: number;
  /** Speaker name (for multi-party conversations). */
  speaker?: string;
}

/** A conversation session containing multiple turns. */
export interface ConversationSession {
  id: string;
  turns: ConversationTurn[];
  metadata?: Record<string, unknown>;
}

/** A benchmark query with ground truth. */
export interface BenchmarkQuery {
  id: string;
  /** The query text to search for. */
  query: string;
  /** Expected answer text (for answer quality evaluation). */
  expectedAnswer: string;
  /** IDs of relevant memories/documents that should be retrieved. */
  relevantIds?: string[];
  /** Query category for breakdown analysis. */
  category?: string;
  /** Metadata about this query. */
  metadata?: Record<string, unknown>;
}

/** A complete benchmark dataset. */
export interface BenchmarkDataset {
  name: string;
  description: string;
  /** Conversation sessions to ingest. */
  sessions: ConversationSession[];
  /** Queries to evaluate. */
  queries: BenchmarkQuery[];
}

// === Adapter Types ===

/** Result of a single retrieval operation. */
export interface RetrievalResult {
  /** Memory/document ID. */
  id: string;
  /** Retrieved content. */
  content: string;
  /** Relevance score from the system. */
  score: number;
  /** Additional metadata. */
  metadata?: Record<string, unknown>;
}

/** Result of a single query execution. */
export interface QueryExecution {
  queryId: string;
  query: string;
  /** Retrieved results, ordered by relevance. */
  results: RetrievalResult[];
  /** Generated answer (if the adapter supports answer generation). */
  generatedAnswer?: string;
  /** Query latency in milliseconds. */
  latencyMs: number;
}

/** Adapter interface — wraps any memory system for benchmarking. */
export interface MemoryAdapter {
  /** Human-readable name for reports. */
  readonly name: string;

  /** Initialize the memory system (create backend, etc.). */
  setup(): Promise<void>;

  /** Ingest a conversation session into the memory system. */
  ingest(session: ConversationSession): Promise<void>;

  /** Query the memory system. */
  query(queryText: string, limit?: number): Promise<QueryExecution>;

  /** Reset all state (between benchmark runs). */
  reset(): Promise<void>;

  /** Clean up resources. */
  teardown(): Promise<void>;
}

// === Metric Types ===

/** Score from a single metric on a single query. */
export interface MetricScore {
  /** Metric name (e.g., "precision@5", "token_f1", "llm_judge"). */
  metric: string;
  /** Score value (0-1 for most metrics). */
  value: number;
  /** Optional details for debugging. */
  details?: Record<string, unknown>;
}

/** A metric evaluator. */
export interface Metric {
  readonly name: string;

  /** Evaluate a single query execution against ground truth. */
  evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore>;
}

// === Report Types ===

/** Per-query result. */
export interface QueryResult {
  queryId: string;
  query: string;
  category?: string;
  scores: MetricScore[];
  latencyMs: number;
  retrievedCount: number;
}

/** Per-category aggregate. */
export interface CategoryResult {
  category: string;
  queryCount: number;
  /** Average score per metric. */
  averages: Record<string, number>;
}

/** Full benchmark report. */
export interface BenchmarkReport {
  /** Adapter name. */
  adapter: string;
  /** Suite name. */
  suite: string;
  /** Dataset name. */
  dataset: string;
  /** When the benchmark ran. */
  timestamp: string;
  /** Total queries evaluated. */
  totalQueries: number;
  /** Overall averages per metric. */
  overall: Record<string, number>;
  /** Per-category breakdown. */
  categories: CategoryResult[];
  /** Per-query details. */
  queries: QueryResult[];
  /** Latency stats. */
  latency: {
    p50: number;
    p95: number;
    p99: number;
    mean: number;
  };
  /** Total wall-clock time in ms. */
  totalTimeMs: number;
}
