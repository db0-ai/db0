import type { MemoryContent } from "../types.js";

/**
 * Default summarize function: extracts the first sentence from content.
 * Zero-config, zero LLM calls. Used when no custom summarizeFn is provided.
 */
export function defaultSummarize(content: MemoryContent): string {
  const text =
    typeof content === "string" ? content : JSON.stringify(content);

  // Match first sentence: up to first period/question/exclamation followed by space or end
  const match = text.match(/^[^.!?]*[.!?]/);
  if (match && match[0].length >= 10) return match[0].trim();

  // Fallback: first 120 chars
  return text.length <= 120 ? text : text.slice(0, 117) + "...";
}
