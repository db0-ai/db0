/**
 * Fallback extraction — creates a low-confidence memory when primary
 * extraction returns nothing from a substantial message.
 *
 * Design principles (from expert review):
 * - Don't turn every missed extraction into noisy junk memory
 * - Mark fallback memories as low-confidence and low-priority
 * - Keep provenance explicit: sourceType, extractionMethod, confidence
 * - Goal: "fail soft and visibly" — not "capture everything"
 */

import type { ExtractionResult, MemoryScope } from "../types.js";
import { isNoise } from "./noise.js";

/**
 * Minimum content length (in characters) to consider for fallback extraction.
 * Short messages (greetings, confirmations, one-liners) are not worth a fallback.
 */
const MIN_FALLBACK_LENGTH = 80;

/**
 * Maximum number of sentences to include in a fallback summary.
 * We condense rather than store the full message.
 */
const MAX_FALLBACK_SENTENCES = 3;

/**
 * Patterns that indicate the message contains a decision, preference,
 * or factual claim — even if it didn't match the primary signal words.
 * These are weaker signals that warrant a low-confidence capture.
 */
const SOFT_SIGNAL_PATTERNS: Array<{ pattern: RegExp; scope: MemoryScope }> = [
  // Statements of fact or preference (weaker than primary signals)
  { pattern: /\b(I|we) (want|need|think|believe|feel|know)\b/i, scope: "session" },
  { pattern: /\b(should|must|have to|ought to)\b/i, scope: "session" },
  { pattern: /\b(changed|switched|moved|updated|replaced|migrated)\b/i, scope: "session" },
  { pattern: /\b(because|since|due to|reason)\b/i, scope: "session" },
  { pattern: /\b(plan|strategy|approach|architecture|design)\b/i, scope: "session" },
  { pattern: /\b(bug|issue|problem|error|broken|fix)\b/i, scope: "task" },
  { pattern: /\b(deploy|release|ship|launch|publish)\b/i, scope: "task" },
];

/**
 * Check whether content is substantial enough to warrant a fallback memory.
 * Returns false for noise, short messages, and purely procedural content.
 */
export function isFallbackCandidate(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < MIN_FALLBACK_LENGTH) return false;

  // Split into sentences and filter noise
  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const substantive = sentences.filter((s) => !isNoise(s));
  if (substantive.length === 0) return false;

  // Must have at least one soft signal
  return SOFT_SIGNAL_PATTERNS.some((sp) => sp.pattern.test(trimmed));
}

/**
 * Create a fallback extraction result from content that the primary
 * strategy couldn't extract from. Condenses to key sentences and
 * marks as low-confidence.
 */
export function createFallbackExtraction(content: string): ExtractionResult | null {
  if (!isFallbackCandidate(content)) return null;

  const trimmed = content.trim();

  // Determine scope from soft signals
  let scope: MemoryScope = "session";
  for (const sp of SOFT_SIGNAL_PATTERNS) {
    if (sp.pattern.test(trimmed)) {
      scope = sp.scope;
      break;
    }
  }

  // Condense: take the first N non-noise sentences
  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isNoise(s));

  const condensed = sentences.slice(0, MAX_FALLBACK_SENTENCES).join(" ");
  if (condensed.length < 20) return null;

  return {
    content: condensed,
    scope,
    tags: ["fallback-extraction"],
    sourceType: "inference",
    extractionMethod: "fallback",
    confidence: 0.3,
  };
}
