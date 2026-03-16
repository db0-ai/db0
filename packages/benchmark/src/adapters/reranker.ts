import type { QueryExecution } from "../types.js";

/**
 * Create a Gemini-based reranker.
 *
 * Takes the query and candidate results, asks Gemini to score relevance,
 * and reorders by the LLM's assessment.
 */
export function createGeminiReranker(apiKey: string) {
  return async (
    query: string,
    results: QueryExecution["results"],
  ): Promise<QueryExecution["results"]> => {
    if (results.length === 0) return results;

    // Truncate each result to keep prompt reasonable
    const candidates = results.slice(0, 15).map((r, i) => ({
      idx: i,
      preview: r.content.slice(0, 300),
    }));

    const prompt = `You are a relevance judge. Given a question and candidate passages, score each passage's relevance to answering the question.

Question: ${query}

Passages:
${candidates.map((c) => `[${c.idx}] ${c.preview}`).join("\n\n")}

For each passage index, output a relevance score from 0 to 10 (10 = directly answers the question, 0 = completely irrelevant).
Output ONLY a JSON array of objects like: [{"idx": 0, "score": 7}, {"idx": 1, "score": 2}, ...]
No explanation, just the JSON array.`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 500 },
          }),
        },
      );

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

      // Parse JSON from response (may have markdown fences)
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      const scores: Array<{ idx: number; score: number }> = JSON.parse(jsonStr);

      // Build score map
      const scoreMap = new Map(scores.map((s) => [s.idx, s.score]));

      // Reorder results by LLM score (descending), then by original score
      const reranked = results.map((r, i) => ({
        ...r,
        score: (scoreMap.get(i) ?? 0) / 10, // normalize to 0-1
      }));

      reranked.sort((a, b) => b.score - a.score);
      return reranked;
    } catch {
      // On failure, return original order
      return results;
    }
  };
}
