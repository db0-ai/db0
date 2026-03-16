import type { Metric, MetricScore, QueryExecution, BenchmarkQuery } from "../types.js";

/**
 * Token F1 — harmonic mean of token-level precision and recall.
 *
 * Standard metric from LoCoMo and SQuAD benchmarks.
 * Normalizes text (lowercase, strip punctuation, remove articles, tokenize).
 */
export class TokenF1Metric implements Metric {
  readonly name = "token_f1";

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    const predicted = execution.generatedAnswer ?? "";
    const expected = query.expectedAnswer;

    if (!predicted.trim() || !expected.trim()) {
      return { metric: this.name, value: 0, details: { precision: 0, recall: 0 } };
    }

    const predTokens = normalize(predicted);
    const expTokens = normalize(expected);

    if (predTokens.length === 0 && expTokens.length === 0) {
      return { metric: this.name, value: 1.0, details: { precision: 1, recall: 1 } };
    }
    if (predTokens.length === 0 || expTokens.length === 0) {
      return { metric: this.name, value: 0, details: { precision: 0, recall: 0 } };
    }

    const expSet = new Set(expTokens);
    const predSet = new Set(predTokens);

    const common = predTokens.filter((t) => expSet.has(t)).length;
    const precision = common / predTokens.length;
    const recall = common / expTokens.length;

    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    return {
      metric: this.name,
      value: f1,
      details: { precision, recall, commonTokens: common, predLength: predTokens.length, expLength: expTokens.length },
    };
  }
}

const ARTICLES = new Set(["a", "an", "the"]);

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !ARTICLES.has(t));
}
