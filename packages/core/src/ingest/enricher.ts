/**
 * Sliding Window Chunk Enrichment
 *
 * Each chunk is processed by an LLM using surrounding context to resolve
 * pronouns, co-references, and temporal references. Supports two modes:
 * - augment: extract metadata header, prepend to original chunk
 * - rewrite: rewrite chunk to be self-contained
 *
 * c'_i = f_θ(c_i | W_i) where W_i is the sliding context window
 */

/**
 * Function that enriches a single chunk using surrounding context.
 * Takes the chunk text and a context object, returns the enriched chunk.
 */
export type ChunkEnrichFn = (
  chunk: string,
  context: {
    /** Text from preceding chunks (sliding window). */
    before: string;
    /** Text from following chunks (sliding window). */
    after: string;
    /** 0-based index of this chunk. */
    chunkIndex: number;
    /** Total number of chunks. */
    totalChunks: number;
  },
) => Promise<string>;

/**
 * Enrich an array of chunks using a sliding window approach.
 *
 * For each chunk, gathers `windowSize` neighboring chunks on each side
 * as context, then calls `enrichFn` to produce a self-contained version.
 *
 * @param chunks - Raw chunks from chunkText()
 * @param enrichFn - LLM-backed enrichment function
 * @param windowSize - Number of neighboring chunks on each side (default: 1)
 * @returns Enriched chunks in the same order
 */
export async function enrichChunks(
  chunks: string[],
  enrichFn: ChunkEnrichFn,
  windowSize = 1,
): Promise<string[]> {
  const enriched: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const beforeStart = Math.max(0, i - windowSize);
    const afterEnd = Math.min(chunks.length, i + windowSize + 1);

    const before = chunks.slice(beforeStart, i).join("\n\n");
    const after = chunks.slice(i + 1, afterEnd).join("\n\n");

    const result = await enrichFn(chunks[i], {
      before,
      after,
      chunkIndex: i,
      totalChunks: chunks.length,
    });

    enriched.push(result);
  }

  return enriched;
}

/**
 * Default system prompt for chunk enrichment (rewrite mode).
 * Instructs the LLM to resolve references while preserving meaning.
 */
export const CHUNK_ENRICH_PROMPT = `You are a text preprocessor for a memory retrieval system. Your job is to rewrite a text chunk so it is self-contained and independently understandable.

Given a CHUNK and its surrounding CONTEXT, rewrite the CHUNK by:
1. **Resolve pronouns**: Replace "he", "she", "they", "it", etc. with the actual names/entities from context.
2. **Resolve co-references**: Replace "the project", "that issue", "the meeting" with specific names when identifiable from context.
3. **Ground temporal references**: Replace "yesterday", "next week", "last time" with actual dates/times if available in context.
4. **Preserve all factual content**: Do NOT remove, summarize, or add information. Keep every fact from the original chunk.
5. **Keep the same structure**: Maintain speaker labels (e.g., "user:", "assistant:"), line breaks, and formatting.

Rules:
- If a reference cannot be resolved from context, leave it as-is.
- Do NOT add explanations, headers, or commentary.
- Output ONLY the rewritten chunk.`;

/**
 * Augmentation prompt for chunk enrichment (augment mode).
 * Instead of rewriting, extracts a metadata header and prepends it to the
 * original chunk. Preserves the original text verbatim while adding context.
 */
export const CHUNK_AUGMENT_PROMPT = `You are a metadata extractor for a memory retrieval system. Given a CHUNK of conversation and its surrounding CONTEXT, extract key contextual metadata that would help someone understand this chunk in isolation.

Output a brief metadata header with these fields (skip any that aren't applicable):
- People: names of people mentioned or speaking (resolve pronouns from context)
- Topics: key topics discussed
- Dates: any dates mentioned or implied (resolve "yesterday", "last week" etc. using context)
- Facts: 1-3 key facts stated in this chunk

Rules:
- Output ONLY the metadata lines, one per line, in "Key: value" format
- Be concise — each line should be under 100 characters
- Do NOT repeat or summarize the chunk content
- Do NOT include explanations`;
