// Main factory — the recommended entry point
export { db0, Db0ContextEngine } from "./context-engine.js";
export type {
  ContextEngine,
  ContextEngineInfo,
  AgentMessage,
  AssembleResult,
  CompactResult,
  IngestResult,
  IngestBatchResult,
  BootstrapResult,
  SubagentSpawnPreparation,
  SubagentEndReason,
  Db0PluginConfig,
} from "./context-engine.js";

// Memory backend
export { Db0MemoryBackend } from "./memory-backend.js";
export type {
  Db0MemoryBackendConfig,
  OpenClawMemorySearchResult,
  FileSnapshot,
  OverwriteEvent,
  FileRollbackResult,
  SyncContentDelta,
} from "./memory-backend.js";

// Re-export core so users don't need a separate install for types
export {
  db0 as db0Core,
  Harness,
  Memory,
  State,
  Log,
  cosineSimilarity,
  hashEmbed,
  defaultEmbeddingFn,
  createExtractionStrategy,
  RulesExtractionStrategy,
  ManualExtractionStrategy,
  LlmExtractionStrategy,
  VersionConflictError,
  generateId,
  rrfMerge,
  ftsScore,
  chunkText,
  ingestFile,
  mergeProfiles,
  PROFILES,
  PROFILE_CONVERSATIONAL,
  PROFILE_AGENT_CONTEXT,
  PROFILE_KNOWLEDGE_BASE,
  PROFILE_CODING_ASSISTANT,
  PROFILE_CURATED_MEMORY,
  PROFILE_HIGH_RECALL,
  PROFILE_MINIMAL,
} from "@db0-ai/core";

export type {
  Db0Profile,
  Db0Backend,
  HarnessConfig,
  MemoryScope,
  MemoryStatus,
  MemoryContent,
  MemoryEntry,
  MemorySearchResult,
  MemoryWriteOpts,
  MemorySearchOpts,
  MemoryEdgeType,
  MemoryEdge,
  MemoryEdgeWriteOpts,
  StateCheckpoint,
  StateCheckpointOpts,
  LogEntry,
  LogAppendOpts,
  LogLevel,
  ExtractionStrategy,
  ExtractionResult,
  LlmExtractionConfig,
  SpawnConfig,
  ChunkOpts,
  FileIngestOpts,
} from "@db0-ai/core";

// Embedding providers
export { createEmbeddingFn, createBatchEmbeddingFn, autoDetectProvider, deriveEmbeddingId } from "./embeddings.js";
export type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingFn,
  BatchEmbeddingFn,
} from "./embeddings.js";

// Legacy migration
export {
  migrateFromOpenClaw,
  parseLegacyMarkdown,
  discoverLegacyMemories,
} from "./migrate.js";
export type {
  LegacyMemoryEntry,
  MigrateOptions,
  MigrateResult,
} from "./migrate.js";

// Re-export SQLite backend (bundled default)
export { createSqliteBackend, SqliteBackend } from "@db0-ai/backends-sqlite";
