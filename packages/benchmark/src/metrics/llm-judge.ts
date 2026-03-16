import type { Metric, MetricScore, QueryExecution, BenchmarkQuery } from "../types.js";

export interface LlmJudgeOptions {
  /**
   * Function that calls an LLM to judge answer correctness.
   * Should return a score between 0 and 1.
   */
  judgeFn: (params: {
    question: string;
    expectedAnswer: string;
    generatedAnswer: string;
    retrievedContext: string;
  }) => Promise<number>;
}

/**
 * LLM Judge — uses an LLM to score answer correctness.
 *
 * This is the headline metric from BRV-Bench.
 * The judge receives the question, expected answer, generated answer,
 * and retrieved context, then returns a binary correct/incorrect score.
 */
export class LlmJudgeMetric implements Metric {
  readonly name = "llm_judge";
  private judgeFn: LlmJudgeOptions["judgeFn"];

  constructor(opts: LlmJudgeOptions) {
    this.judgeFn = opts.judgeFn;
  }

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    const generatedAnswer = execution.generatedAnswer ?? "";

    const isUnanswerable = !query.expectedAnswer.trim() || query.expectedAnswer === "undefined";
    const looksLikeRefusal = /\b(don't have enough|cannot answer|no information|not enough information|unable to (answer|determine)|no evidence)\b/i.test(generatedAnswer);

    if (!generatedAnswer.trim()) {
      if (isUnanswerable) {
        return { metric: this.name, value: 1.0, details: { type: "unanswerable-correct" } };
      }
      return { metric: this.name, value: 0, details: { type: "no-answer" } };
    }

    // If the question is unanswerable and the system refused to answer → correct
    if (isUnanswerable && looksLikeRefusal) {
      return { metric: this.name, value: 1.0, details: { type: "unanswerable-refused" } };
    }
    // If the question is unanswerable but the system gave a fabricated answer → wrong
    if (isUnanswerable && !looksLikeRefusal) {
      return { metric: this.name, value: 0, details: { type: "unanswerable-fabricated", generatedAnswer: generatedAnswer.slice(0, 200) } };
    }

    const retrievedContext = execution.results
      .map((r) => r.content)
      .join("\n---\n");

    const score = await this.judgeFn({
      question: query.query,
      expectedAnswer: query.expectedAnswer,
      generatedAnswer,
      retrievedContext,
    });

    return {
      metric: this.name,
      value: score,
      details: { generatedAnswer: generatedAnswer.slice(0, 200) },
    };
  }
}

/**
 * Create a Gemini-based LLM judge.
 */
export function createGeminiJudge(apiKey: string): LlmJudgeOptions["judgeFn"] {
  return async ({ question, expectedAnswer, generatedAnswer }) => {
    const prompt = `You are evaluating an AI memory system's answer accuracy.

Question: ${question}
Expected answer: ${expectedAnswer}
System's answer: ${generatedAnswer}

Evaluation rules:
- Score 1 if the system's answer contains the essential factual content of the expected answer (dates, names, key facts).
- Score 1 even if wording differs, as long as the meaning is equivalent.
- Score 0 if the answer is wrong, attributes facts to wrong person, or says "I don't have enough information" when an answer exists.
- For "unanswerable" questions (expected answer is empty/undefined): score 1 if the system correctly indicates it cannot answer, score 0 if it provides a fabricated answer.

Answer with ONLY "1" if correct or "0" if incorrect.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 5 },
        }),
      },
    );

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "0";
    return text.startsWith("1") ? 1.0 : 0.0;
  };
}

/**
 * Simple answer generator using retrieved context + Gemini.
 * Adds generatedAnswer to QueryExecution for LLM Judge scoring.
 */
export function createGeminiAnswerGenerator(apiKey: string) {
  return async (question: string, retrievedContext: string): Promise<string> => {
    const prompt = `You are answering questions about past conversations between specific people. Read the context carefully.

Context from past conversations:
${retrievedContext}

Question: ${question}

CRITICAL INSTRUCTIONS:
1. SPEAKER VERIFICATION: The question asks about a specific person. Verify that the context attributes the relevant fact to THAT EXACT person, not someone else. If the context shows a different person did/said it, answer "I don't have enough information."
2. TEMPORAL REASONING: Session dates appear as "Date: <time> on <date>". When someone says "yesterday", "last week", "last Sunday", etc., compute the actual date from the session date. Example: if the session date is "8 May, 2023" and someone says "yesterday", the answer is "7 May 2023".
3. EVIDENCE REQUIREMENT: Only answer if the context explicitly supports the answer. Do NOT guess or infer beyond what is stated.
4. Be specific and concise (1-3 sentences max).

Think step by step:
- Who is the question about?
- Does the context mention this specific person doing/saying the relevant thing?
- If dates are involved, what is the session date and what relative date was mentioned?

Answer:`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 400 },
        }),
      },
    );

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  };
}

// ── OpenAI variants ─────────────────────────────────────────────────────────

/** Helper to call OpenAI chat completions. */
async function openaiChat(apiKey: string, messages: Array<{ role: string; content: string }>, maxTokens = 200): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(`OpenAI: ${data.error.message}`);
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Create an OpenAI-based LLM judge.
 */
export function createOpenAIJudge(apiKey: string): LlmJudgeOptions["judgeFn"] {
  return async ({ question, expectedAnswer, generatedAnswer }) => {
    const prompt = `You are evaluating an AI memory system's answer accuracy.

Question: ${question}
Expected answer: ${expectedAnswer}
System's answer: ${generatedAnswer}

Evaluation rules:
- Score 1 if the system's answer contains the essential factual content of the expected answer (dates, names, key facts).
- Score 1 even if wording differs, as long as the meaning is equivalent.
- Score 0 if the answer is wrong, attributes facts to wrong person, or says "I don't have enough information" when an answer exists.
- For "unanswerable" questions (expected answer is empty/undefined): score 1 if the system correctly indicates it cannot answer, score 0 if it provides a fabricated answer.

Answer with ONLY "1" if correct or "0" if incorrect.`;

    const text = await openaiChat(apiKey, [{ role: "user", content: prompt }], 5);
    return text.startsWith("1") ? 1.0 : 0.0;
  };
}

/**
 * OpenAI answer generator using retrieved context.
 */
export function createOpenAIAnswerGenerator(apiKey: string) {
  return async (question: string, retrievedContext: string): Promise<string> => {
    const prompt = `You are answering questions about past conversations between specific people. Read the context carefully.

Context from past conversations:
${retrievedContext}

Question: ${question}

CRITICAL INSTRUCTIONS:
1. SPEAKER VERIFICATION: The question asks about a specific person. Verify that the context attributes the relevant fact to THAT EXACT person, not someone else. If the context shows a different person did/said it, answer "I don't have enough information."
2. TEMPORAL REASONING: Session dates appear as "Date: <time> on <date>". When someone says "yesterday", "last week", "last Sunday", etc., compute the actual date from the session date. Example: if the session date is "8 May, 2023" and someone says "yesterday", the answer is "7 May 2023".
3. EVIDENCE REQUIREMENT: Only answer if the context explicitly supports the answer. Do NOT guess or infer beyond what is stated.
4. Be specific and concise (1-3 sentences max).

Think step by step:
- Who is the question about?
- Does the context mention this specific person doing/saying the relevant thing?
- If dates are involved, what is the session date and what relative date was mentioned?

Answer:`;

    return openaiChat(apiKey, [{ role: "user", content: prompt }], 400);
  };
}

/**
 * Create a Gemini-based fact extraction function for LLM-extract ingestion mode.
 * Mirrors OpenClaw's Tier 1 LLM extraction pipeline.
 */
export function createGeminiFactExtractor(apiKey: string) {
  return async (text: string): Promise<Array<{ content: string; tags: string[] }>> => {
    const prompt = `Extract durable facts from this conversation text. Focus on:
- Personal facts: names, relationships, preferences, identity details
- Events: activities done, places visited, experiences mentioned
- Temporal facts: dates, times, plans, when things happened
- Decisions: agreements, conclusions, plans made

Text: ${text}

Return a JSON array of objects with "content" (the fact as a concise statement) and "tags" (relevant tags).
Example: [{"content": "Caroline went to a LGBTQ support group", "tags": ["event", "person:Caroline"]}, {"content": "Session date: 8 May 2023", "tags": ["temporal"]}]

If no facts worth extracting, return [].
Return ONLY the JSON array, no markdown or explanation.`;

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

      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";
      const jsonStr = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      return JSON.parse(jsonStr) as Array<{ content: string; tags: string[] }>;
    } catch {
      return [];
    }
  };
}
