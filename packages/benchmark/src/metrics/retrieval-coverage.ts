import type { Metric, MetricScore, QueryExecution, BenchmarkQuery } from "../types.js";

/**
 * Retrieval Coverage — checks if the expected answer appears in any retrieved result.
 *
 * This is the primary metric for retrieval-only benchmarks (no LLM answer generation).
 * Scores 1.0 if any retrieved content contains the expected answer, 0.0 otherwise.
 *
 * For unanswerable queries (empty expectedAnswer), scores 1.0 if no results
 * contain answer-like content, 0.0 if false positive results are returned.
 */
export class RetrievalCoverageMetric implements Metric {
  readonly name = "retrieval_coverage";

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    const expected = query.expectedAnswer.trim();

    // Unanswerable: score 1.0 if few/no relevant results
    if (!expected) {
      const isClean = execution.results.length === 0 || execution.results[0].score < 0.5;
      return {
        metric: this.name,
        value: isClean ? 1.0 : 0.0,
        details: { type: "unanswerable", resultCount: execution.results.length },
      };
    }

    // Check if any retrieved content contains the expected answer (case-insensitive)
    const normalizedExpected = expected.toLowerCase();

    // Handle multi-answer format ("answer1 | answer2")
    const expectedParts = normalizedExpected.split("|").map((p) => p.trim());

    let matchedParts = 0;
    for (const part of expectedParts) {
      const found = execution.results.some((r) => r.content.toLowerCase().includes(part));
      if (found) matchedParts++;
    }

    const coverage = matchedParts / expectedParts.length;

    // Also compute rank of first hit
    let firstHitRank: number | null = null;
    for (let i = 0; i < execution.results.length; i++) {
      const content = execution.results[i].content.toLowerCase();
      if (expectedParts.some((p) => content.includes(p))) {
        firstHitRank = i + 1;
        break;
      }
    }

    return {
      metric: this.name,
      value: coverage,
      details: {
        matchedParts,
        totalParts: expectedParts.length,
        firstHitRank,
        resultCount: execution.results.length,
      },
    };
  }
}

/**
 * Top-K Hit Rate — 1.0 if expected answer is in top-K results, 0.0 otherwise.
 */
export class TopKHitRate implements Metric {
  readonly name: string;
  private k: number;

  constructor(k = 3) {
    this.k = k;
    this.name = `hit_rate@${k}`;
  }

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    const expected = query.expectedAnswer.trim();
    if (!expected) {
      return { metric: this.name, value: 1.0, details: { type: "unanswerable" } };
    }

    const normalizedExpected = expected.toLowerCase();
    const expectedParts = normalizedExpected.split("|").map((p) => p.trim());

    const topK = execution.results.slice(0, this.k);
    const hit = topK.some((r) => {
      const content = r.content.toLowerCase();
      return expectedParts.some((p) => content.includes(p));
    });

    return {
      metric: this.name,
      value: hit ? 1.0 : 0.0,
      details: { k: this.k, checked: topK.length },
    };
  }
}
