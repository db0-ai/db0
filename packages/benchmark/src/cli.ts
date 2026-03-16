#!/usr/bin/env node

import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { defaultEmbeddingFn, CHUNK_AUGMENT_PROMPT, CHUNK_ENRICH_PROMPT } from "@db0-ai/core";
import type { ChunkEnrichFn } from "@db0-ai/core";
import { Db0Adapter } from "./adapters/db0-adapter.js";
import { createGeminiReranker } from "./adapters/reranker.js";
import { RetrievalCoverageMetric, TopKHitRate } from "./metrics/index.js";
import { TokenF1Metric } from "./metrics/token-f1.js";
import { LlmJudgeMetric, createGeminiJudge, createGeminiAnswerGenerator, createGeminiFactExtractor, createOpenAIJudge, createOpenAIAnswerGenerator } from "./metrics/llm-judge.js";
import { runBenchmark } from "./runners/runner.js";
import { formatReport, exportReportJSON } from "./runners/reporter.js";
import { MrNiahScoreMetric } from "./metrics/mr-niah-score.js";
import { createRecallDataset, runFeatureBenchmark } from "./suites/index.js";
import { loadLoCoMoDataset } from "./suites/locomo.js";
import { loadMrNiahDataset, listMrNiahFiles, MR_NIAH_TOKEN_BUCKETS } from "./suites/mr-niah.js";
import { loadLongMemEval, longMemEvalToDataset, LONGMEMEVAL_CATEGORIES } from "./suites/longmemeval.js";
import type { QueryResult, CategoryResult, BenchmarkReport } from "./types.js";
import { PROFILES } from "@db0-ai/core";

async function main() {
  const args = process.argv.slice(2);
  const suite = getArg(args, "--suite") ?? "all";
  const outputJson = args.includes("--json");
  const embeddingProvider = getArg(args, "--embeddings") ?? "hash";

  // Resolve embedding function
  const embeddingFn = await resolveEmbeddingFn(embeddingProvider);

  if (suite === "all" || suite === "recall") {
    console.log("\n  Running: Simple Recall Benchmark...\n");

    const adapter = new Db0Adapter({
      createBackend: () => createSqliteBackend({ dbPath: ":memory:" }),
      embeddingFn,
      scoring: "hybrid",
    });

    const report = await runBenchmark({
      adapter,
      dataset: createRecallDataset(),
      metrics: [
        new RetrievalCoverageMetric(),
        new TopKHitRate(1),
        new TopKHitRate(3),
        new TopKHitRate(5),
      ],
      onProgress: (completed, total, queryId) => {
        process.stdout.write(`\r  Progress: ${completed}/${total} (${queryId})`);
      },
    });

    process.stdout.write("\r" + " ".repeat(60) + "\r");

    if (outputJson) {
      console.log(exportReportJSON(report));
    } else {
      console.log(formatReport(report));
    }
  }

  if (suite === "all" || suite === "features") {
    console.log("\n  Running: Feature Benchmark...\n");

    const report = await runFeatureBenchmark(
      () => createSqliteBackend({ dbPath: ":memory:" }),
      embeddingFn,
    );

    console.log(`  ── db0 Feature Tests ──`);
    for (const r of report.results) {
      const icon = r.passed ? "  PASS" : "  FAIL";
      console.log(`  ${icon}  ${r.name} (${r.latencyMs.toFixed(0)}ms)`);
      if (!r.passed) {
        console.log(`         ${r.details}`);
      }
    }
    console.log(`\n  ${report.passed}/${report.total} passed (${report.totalTimeMs.toFixed(0)}ms)\n`);
  }

  if (suite === "locomo") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("  LoCoMo benchmark requires GEMINI_API_KEY for embeddings and LLM judge.");
      process.exit(1);
    }
    if (embeddingProvider === "hash") {
      console.error("  LoCoMo benchmark requires semantic embeddings. Use --embeddings gemini");
      process.exit(1);
    }

    const maxSamples = Number(getArg(args, "--samples") ?? "1");
    const maxQueries = Number(getArg(args, "--queries") ?? "50");

    console.log(`\n  Running: LoCoMo Benchmark (${maxSamples} sample(s), up to ${maxQueries} queries)...\n`);

    const dataset = loadLoCoMoDataset({
      maxSamples,
      maxQueriesPerSample: maxQueries,
    });

    console.log(`  Loaded: ${dataset.sessions.length} sessions, ${dataset.queries.length} queries\n`);

    // Create answer generator for end-to-end eval
    const generateAnswer = createGeminiAnswerGenerator(apiKey);

    // Configure adapter
    const ingestMode = (getArg(args, "--ingest") ?? "chunk") as "turn" | "session" | "chunk" | "extract" | "turn-context" | "dual" | "llm-extract";
    const useRerank = args.includes("--rerank");
    const useEnrich = args.includes("--enrich");
    const useExpand = args.includes("--expand");
    const enrichMode = (getArg(args, "--enrich-mode") ?? "augment") as "augment" | "rewrite";
    const useLatentBridging = args.includes("--latent-bridging");

    console.log(`  Config: ingest=${ingestMode}, rerank=${useRerank}, enrich=${useEnrich}${useEnrich ? `(${enrichMode})` : ""}, expand=${useExpand}, latentBridging=${useLatentBridging}\n`);

    const baseAdapter = new Db0Adapter({
      createBackend: () => createSqliteBackend({ dbPath: ":memory:" }),
      embeddingFn,
      scoring: "hybrid",
      minScore: 0.1,
      ingestMode,
      chunkSize: 800,
      chunkOverlap: 200,
      ...(useRerank ? { rerankFn: createGeminiReranker(apiKey) } : {}),
      ...(ingestMode === "llm-extract" ? { llmExtractFn: createGeminiFactExtractor(apiKey) } : {}),
      ...(useEnrich && apiKey ? { enrichFn: createGeminiChunkEnricher(apiKey, enrichMode), enrichMode } : {}),
      ...(useExpand && apiKey ? { queryExpandFn: createGeminiQueryExpander(apiKey) } : {}),
      ...(useLatentBridging ? { latentBridging: true } : {}),
    });

    const originalQuery = baseAdapter.query.bind(baseAdapter);
    baseAdapter.query = async (queryText: string, limit?: number) => {
      const exec = await originalQuery(queryText, limit);
      // Use all results for session mode (few docs, big context), top 8 otherwise
      const topN = ingestMode === "session" ? exec.results.length : 8;
      const topResults = exec.results.slice(0, topN);
      const context = topResults.map((r) => r.content).join("\n\n---\n\n");
      if (context.trim()) {
        exec.generatedAnswer = await generateAnswer(queryText, context);
      } else {
        exec.generatedAnswer = "I don't have enough information to answer this question.";
      }
      return exec;
    };

    const report = await runBenchmark({
      adapter: baseAdapter,
      dataset,
      queryLimit: 20,
      metrics: [
        new LlmJudgeMetric({ judgeFn: createGeminiJudge(apiKey) }),
        new TokenF1Metric(),
        new RetrievalCoverageMetric(),
        new TopKHitRate(3),
        new TopKHitRate(5),
      ],
      onProgress: (completed, total, queryId) => {
        process.stdout.write(`\r  Progress: ${completed}/${total} (${queryId})      `);
      },
    });

    process.stdout.write("\r" + " ".repeat(60) + "\r");

    if (outputJson) {
      console.log(exportReportJSON(report));
    } else {
      console.log(formatReport(report));
    }
  }

  if (suite === "longmemeval") {
    if (embeddingProvider === "hash") {
      console.error("  LongMemEval benchmark requires semantic embeddings. Use --embeddings gemini or --embeddings openai");
      process.exit(1);
    }

    // LLM provider for answer generation and judging.
    // --llm flag overrides; defaults to matching embedding provider.
    const llmProvider = getArg(args, "--llm") ?? embeddingProvider;
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (llmProvider === "openai" && !openaiKey) {
      console.error("  OpenAI LLM requires OPENAI_API_KEY.");
      process.exit(1);
    }
    if (llmProvider === "gemini" && !geminiKey) {
      console.error("  Gemini LLM requires GEMINI_API_KEY.");
      process.exit(1);
    }
    // Need at least one LLM for answer generation (unless --retrieval-only)
    const apiKey = llmProvider === "openai" ? openaiKey! : geminiKey!;

    const maxQuestions = Number(getArg(args, "--queries") ?? "500");
    const typesArg = getArg(args, "--types");
    const types = typesArg ? typesArg.split(",") : undefined;

    // Profile selection: conversational is the natural fit for chat memory benchmarks.
    // Use --profile to override (e.g., "high-recall" for maximum score, "agent-context" for mixed workloads).
    const profileName = getArg(args, "--profile") ?? "conversational";
    const profile = PROFILES[profileName];
    if (!profile) {
      console.error(`  Unknown profile: ${profileName}. Available: ${Object.keys(PROFILES).join(", ")}`);
      process.exit(1);
    }

    console.log(`\n  Running: LongMemEval-s Benchmark (up to ${maxQuestions} questions)...`);
    console.log(`  Profile: ${profileName}\n`);

    const questions = loadLongMemEval({ maxQuestions, types });
    console.log(`  Loaded: ${questions.length} questions`);
    if (types) console.log(`  Filtered types: ${types.join(", ")}`);

    // Create adapter configured from profile, with CLI flag overrides
    const ingestMode = (getArg(args, "--ingest") ?? profile.ingest?.mode ?? "session") as "turn" | "session" | "chunk" | "extract" | "turn-context" | "dual" | "llm-extract";
    const useEnrich = args.includes("--enrich") || (profile.ingest?.enrich ?? false);
    const enrichMode = (getArg(args, "--enrich-mode") ?? profile.ingest?.enrichMode ?? "augment") as "augment" | "rewrite";
    const useLatentBridging = args.includes("--latent-bridging") || (profile.ingest?.latentBridging ?? false);
    const useQueryExpansion = args.includes("--expand") || (profile.retrieval?.queryExpansion ?? false);
    const useRerank = args.includes("--rerank");

    console.log(`  Config: ingest=${ingestMode}, scoring=${profile.retrieval?.scoring ?? "hybrid"}, topK=${profile.retrieval?.topK ?? 10}, minScore=${profile.retrieval?.minScore ?? 0.3}`);
    console.log(`          enrich=${useEnrich}${useEnrich ? `(${enrichMode})` : ""}, latentBridging=${useLatentBridging}, queryExpansion=${useQueryExpansion}, llm=${llmProvider}\n`);

    const generateAnswer = llmProvider === "openai"
      ? createOpenAIAnswerGenerator(openaiKey!)
      : createGeminiAnswerGenerator(geminiKey!);

    // Per-question runner: each question has its own haystack of ~48 sessions.
    // Reset → ingest → query → score for each question.
    // --retrieval-only skips answer generation (saves generateContent quota)
    const retrievalOnly = args.includes("--retrieval-only");
    const judgeFn = llmProvider === "openai"
      ? createOpenAIJudge(openaiKey!)
      : createGeminiJudge(geminiKey!);
    const metrics = retrievalOnly
      ? [
          new RetrievalCoverageMetric(),
          new TopKHitRate(3),
          new TopKHitRate(5),
          new TopKHitRate(10),
        ]
      : [
          new LlmJudgeMetric({ judgeFn }),
          new TokenF1Metric(),
          new RetrievalCoverageMetric(),
          new TopKHitRate(3),
          new TopKHitRate(5),
        ];

    const queryResults: QueryResult[] = [];
    const totalStart = performance.now();

    for (let qi = 0; qi < questions.length; qi++) {
      const { query, sessions } = questions[qi];
      process.stdout.write(`\r  Progress: ${qi + 1}/${questions.length} (${query.category})      `);

      // Fresh adapter per question
      const adapter = new Db0Adapter({
        createBackend: () => createSqliteBackend({ dbPath: ":memory:" }),
        embeddingFn,
        scoring: profile.retrieval?.scoring ?? "hybrid",
        minScore: profile.retrieval?.minScore ?? 0.3,
        ingestMode,
        chunkSize: profile.ingest?.chunkSize ?? 800,
        chunkOverlap: profile.ingest?.chunkOverlap ?? 200,
        ...(useEnrich && apiKey ? { enrichFn: createGeminiChunkEnricher(apiKey, enrichMode), enrichMode } : {}),
        ...(useLatentBridging ? { latentBridging: true } : {}),
        ...(useQueryExpansion && apiKey ? { queryExpandFn: createGeminiQueryExpander(apiKey) } : {}),
        ...(useRerank && apiKey ? { rerankFn: createGeminiReranker(apiKey) } : {}),
      });

      await adapter.setup();

      // Ingest this question's haystack
      for (const session of sessions) {
        await adapter.ingest(session);
      }

      // Query
      const topK = profile.retrieval?.topK ?? 10;
      const execution = await adapter.query(query.query, topK);
      execution.queryId = query.id;

      // Generate answer from retrieved context
      // Use more results for session mode (fewer, larger docs) vs chunk mode (many, smaller)
      const topN = ingestMode === "session" ? Math.min(execution.results.length, 10) : 12;
      const topResults = execution.results.slice(0, topN);
      const context = topResults.map((r) => r.content).join("\n\n---\n\n");
      if (!retrievalOnly) {
        if (context.trim()) {
          // Include question_date for temporal reasoning
          const questionDate = query.metadata?.questionDate as string | undefined;
          const augmentedQuery = questionDate
            ? `[Current date: ${questionDate}]\n${query.query}`
            : query.query;
          execution.generatedAnswer = await generateAnswer(augmentedQuery, context);
        } else {
          execution.generatedAnswer = "I don't have enough information to answer this question.";
        }
      }

      // Score
      const scores = await Promise.all(metrics.map((m) => m.evaluate(execution, query)));

      queryResults.push({
        queryId: query.id,
        query: query.query,
        category: query.category,
        scores,
        latencyMs: execution.latencyMs,
        retrievedCount: execution.results.length,
      });

      await adapter.teardown();
    }

    process.stdout.write("\r" + " ".repeat(60) + "\r");

    const totalTimeMs = performance.now() - totalStart;

    // Build report
    const report = buildLongMemEvalReport(queryResults, metrics, totalTimeMs);

    if (outputJson) {
      console.log(exportReportJSON(report));
    } else {
      console.log(formatReport(report));
    }
  }

  if (suite === "mr-niah") {
    if (embeddingProvider === "hash") {
      console.warn("  Warning: hash embeddings will give poor MR-NIAH results. Use --embeddings gemini for meaningful scores.");
    }

    // Parse options
    const languages = (getArg(args, "--lang") ?? "english").split(",") as Array<"english" | "chinese">;
    const bucketsArg = getArg(args, "--buckets");
    const tokenBuckets = bucketsArg
      ? bucketsArg.split(",").map(Number)
      : undefined; // use default (5 smallest)
    const maxPerFile = Number(getArg(args, "--samples") || "0") || undefined;
    const ingestMode = (getArg(args, "--ingest") ?? "turn") as "turn" | "session" | "chunk" | "turn-context" | "dual";
    const useRerank = args.includes("--rerank");
    const useEnrich = args.includes("--enrich");
    const useExpand = args.includes("--expand");
    const enrichMode = (getArg(args, "--enrich-mode") ?? "augment") as "augment" | "rewrite";
    const useLatentBridging = args.includes("--latent-bridging");

    // Check data availability
    const available = listMrNiahFiles();
    if (available.length === 0) {
      console.error("  MR-NIAH data not found. Download with:");
      console.error("    bash packages/benchmark/scripts/fetch-mr-niah.sh");
      process.exit(1);
    }
    console.log(`\n  MR-NIAH data: ${available.length} files available`);

    const dataset = loadMrNiahDataset({ languages, tokenBuckets, maxSamplesPerFile: maxPerFile });
    console.log(`\n  Running: MR-NIAH Benchmark (${dataset.sessions.length} conversations, ${dataset.queries.length} queries)`);
    console.log(`  Config: lang=${languages.join(",")}, ingest=${ingestMode}, rerank=${useRerank}, enrich=${useEnrich}${useEnrich ? `(${enrichMode})` : ""}, expand=${useExpand}, latentBridging=${useLatentBridging}\n`);

    // For MR-NIAH, we need an answer generator to produce verbatim recall
    const apiKey = process.env.GEMINI_API_KEY;
    const generateAnswer = apiKey ? createMrNiahAnswerGenerator(apiKey) : null;

    const baseAdapter = new Db0Adapter({
      createBackend: () => createSqliteBackend({ dbPath: ":memory:" }),
      embeddingFn,
      scoring: "hybrid",
      minScore: 0.1,
      ingestMode,
      chunkSize: 800,
      chunkOverlap: 200,
      ...(useRerank && apiKey ? { rerankFn: createGeminiReranker(apiKey) } : {}),
      ...(useEnrich && apiKey ? { enrichFn: createGeminiChunkEnricher(apiKey, enrichMode), enrichMode } : {}),
      ...(useExpand && apiKey ? { queryExpandFn: createGeminiQueryExpander(apiKey) } : {}),
      ...(useLatentBridging ? { latentBridging: true } : {}),
    });

    // Wrap query to set generatedAnswer for scoring.
    // MR-NIAH tests retrieval quality — can the system find the needle?
    // Default to raw retrieval for MR-NIAH (tests retrieval quality directly).
    // Use --llm-answer to enable LLM verbatim reproduction (tests end-to-end).
    const useRawRetrieval = !args.includes("--llm-answer");
    const originalQuery = baseAdapter.query.bind(baseAdapter);
    baseAdapter.query = async (queryText: string, limit?: number) => {
      const exec = await originalQuery(queryText, limit);
      const topResults = exec.results.slice(0, ingestMode === "session" ? exec.results.length : 5);
      const context = topResults.map((r) => r.content).join("\n\n---\n\n");

      if (!useRawRetrieval && generateAnswer && context.trim()) {
        exec.generatedAnswer = await generateAnswer(queryText, context);
      } else {
        // Score against raw retrieved content directly
        exec.generatedAnswer = context;
      }
      return exec;
    };

    const report = await runBenchmark({
      adapter: baseAdapter,
      dataset,
      queryLimit: 15,
      metrics: [
        new MrNiahScoreMetric(),
        new TokenF1Metric(),
        new RetrievalCoverageMetric(),
        new TopKHitRate(3),
        new TopKHitRate(5),
      ],
      onProgress: (completed, total, queryId) => {
        process.stdout.write(`\r  Progress: ${completed}/${total} (${queryId})      `);
      },
    });

    process.stdout.write("\r" + " ".repeat(60) + "\r");

    if (outputJson) {
      console.log(exportReportJSON(report));
    } else {
      console.log(formatReport(report));
    }
  }
}

/**
 * Sliding Window Chunk Augmentation — extracts metadata from each chunk
 * using surrounding context, to be prepended to the original (unmodified) chunk.
 *
 * Sliding Window Chunk Enrichment: c'_i = f_θ(c_i | W_i).
 * Supports two modes:
 * - "augment": extract metadata header (default, preserves original text)
 * - "rewrite": rewrite chunk to be self-contained (better for structured docs)
 */
function createGeminiChunkEnricher(apiKey: string, mode: "augment" | "rewrite" = "augment"): ChunkEnrichFn {
  const systemPrompt = mode === "rewrite" ? CHUNK_ENRICH_PROMPT : CHUNK_AUGMENT_PROMPT;
  const suffix = mode === "rewrite" ? "Rewritten chunk:" : "Metadata:";

  return async (chunk, context) => {
    const contextParts: string[] = [];
    if (context.before) contextParts.push(`PRECEDING CONTEXT:\n${context.before}`);
    if (context.after) contextParts.push(`FOLLOWING CONTEXT:\n${context.after}`);
    const contextStr = contextParts.length > 0 ? contextParts.join("\n\n") : "(no surrounding context)";

    const prompt = `${systemPrompt}

${contextStr}

CHUNK (chunk ${context.chunkIndex + 1} of ${context.totalChunks}):
${chunk}

${suffix}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1500 },
        }),
      },
    );

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    // Fall back to original chunk if LLM fails
    return result || chunk;
  };
}

/**
 * Adaptive Query Expansion — generates semantically diverse reformulations
 * of a query to improve retrieval recall.
 *
 * Adaptive Query Expansion: generate N diverse reformulations, search each
 * in parallel, merge results via RRF.
 */
function createGeminiQueryExpander(apiKey: string): (query: string) => Promise<string[]> {
  return async (query: string): Promise<string[]> => {
    const prompt = `You are a query expansion system for a conversational memory retrieval engine. Given a user query, generate 2-3 semantically diverse reformulations that would help find relevant memories.

Rules:
- Each reformulation should approach the topic from a different angle
- Include synonyms, related concepts, or alternative phrasings
- Keep reformulations concise (1-2 sentences each)
- Output ONLY the reformulations, one per line, no numbering or bullets

Query: ${query}

Reformulations:`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
        }),
      },
    );

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const reformulations = text
      .split("\n")
      .map((l) => l.replace(/^\d+[\.\)]\s*/, "").replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 5);

    return reformulations.slice(0, 3);
  };
}

/**
 * MR-NIAH answer generator — asks the LLM to repeat the exact content from context.
 * The key is instructing verbatim reproduction, not summarization.
 */
function createMrNiahAnswerGenerator(apiKey: string) {
  return async (question: string, retrievedContext: string): Promise<string> => {
    const prompt = `You are helping recall exact content from past conversations.

Context from past conversations:
${retrievedContext}

Question: ${question}

INSTRUCTIONS:
1. Find the requested content (poem, list, description, etc.) in the context above.
2. Reproduce it EXACTLY and VERBATIM — every word, every line, including punctuation and formatting.
3. Do NOT paraphrase, summarize, reformat, or change any wording.
4. IGNORE ordinal references like "first", "second", "third" — there is only one matching piece of content in the context. Just find and reproduce it.
5. Do NOT add quotes, headers, labels, or any extra text. Output ONLY the requested content.

Answer:`;

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

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  };
}

/**
 * Build a BenchmarkReport from per-question results (LongMemEval custom runner).
 */
function buildLongMemEvalReport(
  queryResults: QueryResult[],
  metrics: { readonly name: string }[],
  totalTimeMs: number,
): BenchmarkReport {
  const computeAverages = (results: QueryResult[]): Record<string, number> => {
    const averages: Record<string, number> = {};
    for (const metric of metrics) {
      const values = results
        .map((r) => r.scores.find((s) => s.metric === metric.name)?.value)
        .filter((v): v is number => v !== undefined);
      averages[metric.name] = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    }
    return averages;
  };

  const grouped = new Map<string, QueryResult[]>();
  for (const r of queryResults) {
    const cat = r.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(r);
  }

  const categories: CategoryResult[] = Array.from(grouped.entries()).map(([category, catResults]) => ({
    category,
    queryCount: catResults.length,
    averages: computeAverages(catResults),
  }));

  const latencies = queryResults.map((r) => r.latencyMs).sort((a, b) => a - b);
  const percentile = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;

  return {
    adapter: "db0",
    suite: "longmemeval-s",
    dataset: "longmemeval-s",
    timestamp: new Date().toISOString(),
    totalQueries: queryResults.length,
    overall: computeAverages(queryResults),
    categories,
    queries: queryResults,
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      mean: latencies.length === 0 ? 0 : latencies.reduce((a, b) => a + b, 0) / latencies.length,
    },
    totalTimeMs,
  };
}

async function resolveEmbeddingFn(provider: string): Promise<(text: string) => Promise<Float32Array>> {
  if (provider === "hash") {
    return defaultEmbeddingFn;
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY required for Gemini embeddings");

    return async (text: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text }] } }),
          },
        );
        const data = await res.json() as { embedding?: { values: number[] }; error?: { message: string } };
        if (data.embedding?.values) {
          return new Float32Array(data.embedding.values);
        }
        // Rate limit or transient error — wait and retry
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          throw new Error(`Gemini embed failed: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
        }
      }
      throw new Error("Gemini embed: unreachable");
    };
  }

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY required for OpenAI embeddings");

    return async (text: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
        });
        const data = await res.json() as { data?: Array<{ embedding: number[] }>; error?: { message: string } };
        if (data.data?.[0]?.embedding) {
          return new Float32Array(data.data[0].embedding);
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          throw new Error(`OpenAI embed failed: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
        }
      }
      throw new Error("OpenAI embed: unreachable");
    };
  }

  throw new Error(`Unknown embedding provider: ${provider}. Use: hash, gemini, openai`);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
