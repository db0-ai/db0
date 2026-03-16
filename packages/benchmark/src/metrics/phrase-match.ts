import type { Metric, MetricScore, QueryExecution, BenchmarkQuery } from "../types.js";

/**
 * Phrase Match Accuracy — fraction of expected phrases found in the generated answer.
 *
 * Inspired by MR-NIAH (Multi-Round Needle-in-a-Haystack) benchmark.
 * Useful for testing exact fact recall from conversation history.
 */
export class PhraseMatchMetric implements Metric {
  readonly name = "phrase_match";

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    const predicted = execution.generatedAnswer ?? "";

    if (!predicted.trim()) {
      return { metric: this.name, value: 0, details: { matched: 0, total: 0 } };
    }

    // Expected answer can contain multiple phrases separated by " | "
    const expectedPhrases = query.expectedAnswer
      .split("|")
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);

    if (expectedPhrases.length === 0) {
      return { metric: this.name, value: 1.0, details: { matched: 0, total: 0 } };
    }

    const normalizedPredicted = predicted.toLowerCase();
    const matched = expectedPhrases.filter((phrase) => normalizedPredicted.includes(phrase)).length;

    return {
      metric: this.name,
      value: matched / expectedPhrases.length,
      details: { matched, total: expectedPhrases.length, phrases: expectedPhrases },
    };
  }
}
