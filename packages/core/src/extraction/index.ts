import type { ExtractionStrategy, LlmExtractionConfig } from "../types.js";
import { LlmExtractionStrategy } from "./llm.js";
import { ManualExtractionStrategy } from "./manual.js";
import { RulesExtractionStrategy } from "./rules.js";

export function createExtractionStrategy(
  type: "rules" | "manual" | "llm" = "rules",
  llmConfig?: LlmExtractionConfig,
): ExtractionStrategy {
  switch (type) {
    case "rules":
      return new RulesExtractionStrategy();
    case "manual":
      return new ManualExtractionStrategy();
    case "llm":
      if (!llmConfig?.extractFn) {
        throw new Error(
          'LLM extraction requires an extractFn. Pass { extraction: { durableFacts: "llm", llm: { extractFn } } } in harness config.',
        );
      }
      return new LlmExtractionStrategy(llmConfig.extractFn);
    default:
      throw new Error(`Unknown extraction strategy: ${type as string}`);
  }
}

export { RulesExtractionStrategy } from "./rules.js";
export { ManualExtractionStrategy } from "./manual.js";
export { LlmExtractionStrategy } from "./llm.js";
export { isNoise, isNoiseBlock } from "./noise.js";
export { isFallbackCandidate, createFallbackExtraction } from "./fallback.js";
export { extractEntities } from "./entities.js";
export type { ExtractedEntity } from "./entities.js";
