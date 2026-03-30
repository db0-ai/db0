import { Harness } from "./harness.js";
import type { HarnessConfig } from "./types.js";

export const db0 = {
  harness(config: HarnessConfig): Harness {
    return new Harness(config);
  },
};

export { Harness } from "./harness.js";
export type { SpawnConfig } from "./harness.js";
export { Memory } from "./components/memory.js";
export { State } from "./components/state.js";
export { Log } from "./components/log.js";
export { Context, formatMemories } from "./components/context.js";
export {
  createExtractionStrategy,
  RulesExtractionStrategy,
  ManualExtractionStrategy,
  LlmExtractionStrategy,
  isNoise,
  isNoiseBlock,
  extractEntities,
  isFallbackCandidate,
  createFallbackExtraction,
} from "./extraction/index.js";
export type { ExtractedEntity } from "./extraction/index.js";
export { cosineSimilarity } from "./util/cosine.js";
export { generateId } from "./util/id.js";
export { hashEmbed, defaultEmbeddingFn } from "./util/embed.js";
export { rrfMerge, ftsScore } from "./util/rrf.js";
export { VersionConflictError } from "./errors.js";
export { defaultSummarize } from "./util/summarize.js";
export { chunkText, ingestFile, enrichChunks, CHUNK_ENRICH_PROMPT, CHUNK_AUGMENT_PROMPT } from "./ingest/index.js";
export type { ChunkOpts, FileIngestOpts, ChunkEnrichFn } from "./ingest/index.js";
export { mergeProfiles } from "./types.js";
export {
  PROFILES,
  PROFILE_CONVERSATIONAL,
  PROFILE_AGENT_CONTEXT,
  PROFILE_KNOWLEDGE_BASE,
  PROFILE_CODING_ASSISTANT,
  PROFILE_CURATED_MEMORY,
  PROFILE_HIGH_RECALL,
  PROFILE_MINIMAL,
} from "./profiles.js";

export type {
  Db0Profile,
  MemoryScope,
  MemoryStatus,
  MemoryContent,
  MemoryWriteOpts,
  MemoryEntry,
  MemorySearchOpts,
  MemorySearchResult,
  MemoryEdgeType,
  MemoryEdge,
  MemoryEdgeWriteOpts,
  StateCheckpointOpts,
  StateCheckpoint,
  LogLevel,
  LogAppendOpts,
  LogEntry,
  Db0Backend,
  ExtractionResult,
  ExtractionStrategy,
  LlmExtractionConfig,
  HarnessConfig,
  EmbeddingFn,
  BatchEmbeddingFn,
  ContextIngestOpts,
  ContextIngestResult,
  ContextPackOpts,
  ContextPackResult,
  PreserveMessage,
  ContextPreserveOpts,
  ContextPreserveResult,
  ContextReconcileOpts,
  ContextReconcileResult,
  ConsolidateFn,
  MemorySourceType,
  MemoryExtractionMethod,
} from "./types.js";
