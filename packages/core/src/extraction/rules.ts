import type { ExtractionResult, ExtractionStrategy, MemoryScope } from "../types.js";
import { isNoise } from "./noise.js";

interface SignalPattern {
  pattern: RegExp;
  scope: MemoryScope;
  tags: string[];
}

const SIGNAL_PATTERNS: SignalPattern[] = [
  // User-level durable facts
  { pattern: /\buser\s+prefer/i, scope: "user", tags: ["preference"] },
  { pattern: /\balways\s+use\b/i, scope: "user", tags: ["preference"] },
  { pattern: /\bremember\s+that\b/i, scope: "user", tags: ["preference"] },
  { pattern: /\bdon'?t\s+like\b/i, scope: "user", tags: ["preference"] },
  { pattern: /\bprefers?\s+to\b/i, scope: "user", tags: ["preference"] },
  { pattern: /\bfavorite\b/i, scope: "user", tags: ["preference"] },
  { pattern: /\bname\s+is\b/i, scope: "user", tags: ["identity"] },
  { pattern: /\blives?\s+in\b/i, scope: "user", tags: ["identity"] },
  { pattern: /\bworks?\s+(at|for)\b/i, scope: "user", tags: ["identity"] },

  // Session-level decisions
  { pattern: /\bdecided\s+to\b/i, scope: "session", tags: ["decision"] },
  { pattern: /\bimportant:/i, scope: "session", tags: ["important"] },
  { pattern: /\bkey\s+takeaway/i, scope: "session", tags: ["important"] },
  { pattern: /\bagreed\s+(to|on|that)\b/i, scope: "session", tags: ["decision"] },
  { pattern: /\bconclusion\b/i, scope: "session", tags: ["decision"] },

  // Task-level context
  { pattern: /\bworking\s+on\b/i, scope: "task", tags: ["task"] },
  { pattern: /\bcurrent\s+task\b/i, scope: "task", tags: ["task"] },
  { pattern: /\bnext\s+steps?\b/i, scope: "task", tags: ["task"] },
  { pattern: /\btodo\b/i, scope: "task", tags: ["task"] },
  { pattern: /\bin\s+progress\b/i, scope: "task", tags: ["task"] },
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class RulesExtractionStrategy implements ExtractionStrategy {
  extract(content: string): ExtractionResult[] {
    const sentences = splitSentences(content);
    const results: ExtractionResult[] = [];

    for (const sentence of sentences) {
      if (isNoise(sentence)) continue;
      for (const signal of SIGNAL_PATTERNS) {
        if (signal.pattern.test(sentence)) {
          results.push({
            content: sentence,
            scope: signal.scope,
            tags: signal.tags,
            sourceType: "user_statement",
            extractionMethod: "rules",
          });
          break; // one match per sentence
        }
      }
    }

    return results;
  }
}
