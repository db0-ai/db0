/**
 * Noise filtering for memory extraction.
 *
 * Filters out low-value content that should never be stored as memories:
 * refusals, greetings, meta-questions, confirmations, and very short fragments.
 */

const NOISE_PATTERNS: RegExp[] = [
  // Refusals
  /^I('m| am) (not able|unable|sorry|afraid I can't)/i,
  /^I can'?t help with that/i,
  /^I('m| am) sorry,? (but )?I/i,
  /^(unfortunately|regrettably),? I (can'?t|cannot|am unable)/i,

  // Greetings & farewells
  /^(hi|hello|hey|good (morning|afternoon|evening))[\s!.,]*$/i,
  /^(thanks|thank you|bye|goodbye|see you|take care)[\s!.,]*$/i,
  /^(welcome|you'?re welcome)[\s!.,]*$/i,

  // Meta-questions & filler
  /^(what|how) (would|can|shall|should) (you|I|we)/i,
  /^(is there anything|do you need|let me know|would you like)/i,
  /^(sure|okay|alright|got it|understood|right|yes|no|yep|nope)[\s!.,]*$/i,
  /^(of course|certainly|absolutely|definitely)[\s!.,]*$/i,

  // Process narration (agent describing its own actions)
  /^(let me|I'?ll|I will|I'?m going to) (search|look|check|find|read|open)/i,
  /^(searching|looking|checking|reading|opening|analyzing)\b/i,
];

const MIN_CONTENT_LENGTH = 12;

/**
 * Returns true if the text is noise that should not be stored as memory.
 */
export function isNoise(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) return true;
  return NOISE_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Returns true if an entire block of text (all sentences) is noise.
 * Useful for short-circuiting LLM extraction calls.
 */
export function isNoiseBlock(text: string): boolean {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return true;
  return sentences.every((s) => isNoise(s));
}
