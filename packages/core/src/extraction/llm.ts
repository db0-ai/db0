import type { ExtractionResult, ExtractionStrategy } from "../types.js";
import { isNoiseBlock } from "./noise.js";

/**
 * LLM-powered extraction strategy.
 *
 * The user provides an async function that calls their LLM and returns
 * structured extraction results. db0 handles the rest.
 *
 * @example
 * ```typescript
 * const strategy = new LlmExtractionStrategy(async (text) => {
 *   const response = await openai.chat.completions.create({
 *     model: "gpt-4o-mini",
 *     messages: [
 *       { role: "system", content: LlmExtractionStrategy.DEFAULT_PROMPT },
 *       { role: "user", content: text },
 *     ],
 *     response_format: { type: "json_object" },
 *   });
 *   return JSON.parse(response.choices[0].message.content!).facts;
 * });
 * ```
 */
export class LlmExtractionStrategy implements ExtractionStrategy {
  /**
   * Default system prompt for LLM-based extraction.
   * Users can use this as a starting point or provide their own.
   */
  static readonly DEFAULT_PROMPT = `You are a fact extraction engine. Given text from an AI assistant's response, extract durable facts worth remembering.

For each fact, return:
- "content": the fact as a concise statement
- "scope": one of "user" (preferences, personal info), "session" (decisions, agreements for this session), "task" (current work context), "agent" (learned capabilities)
- "tags": relevant tags as an array of strings

Return a JSON object with a "facts" array. If no facts are worth extracting, return {"facts": []}.

Examples of facts to extract:
- User preferences: "User prefers dark mode", "User always uses TypeScript"
- Decisions: "Decided to use PostgreSQL for the backend"
- Important context: "The API uses REST, not GraphQL"
- Agreements: "Agreed to write tests for all new features"

Do NOT extract:
- Trivial statements or greetings
- Temporary information like "searching for files"
- Opinions presented as part of analysis (only extract stated decisions/preferences)`;

  constructor(
    private extractFn: (text: string) => Promise<ExtractionResult[]>,
  ) {}

  async extract(content: string): Promise<ExtractionResult[]> {
    if (isNoiseBlock(content)) return [];
    const results = await this.extractFn(content);
    // Stamp provenance on results that don't already have it
    return results.map((r) => ({
      ...r,
      sourceType: r.sourceType ?? "inference",
      extractionMethod: r.extractionMethod ?? "llm",
    }));
  }
}
