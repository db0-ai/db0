import type { Metric, MetricScore, QueryExecution, BenchmarkQuery } from "../types.js";

/**
 * Precision@K — fraction of retrieved docs in top-K that are relevant.
 */
export class PrecisionAtK implements Metric {
  readonly name: string;
  private k: number;

  constructor(k = 5) {
    this.k = k;
    this.name = `precision@${k}`;
  }

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    if (!query.relevantIds || query.relevantIds.length === 0) {
      return { metric: this.name, value: 0, details: { note: "no relevantIds in ground truth" } };
    }

    const relevantSet = new Set(query.relevantIds);
    const topK = execution.results.slice(0, this.k);
    const relevant = topK.filter((r) => relevantSet.has(r.id)).length;

    return {
      metric: this.name,
      value: topK.length === 0 ? 0 : relevant / topK.length,
      details: { relevant, total: topK.length, k: this.k },
    };
  }
}

/**
 * Recall@K — fraction of relevant docs found in top-K results.
 */
export class RecallAtK implements Metric {
  readonly name: string;
  private k: number;

  constructor(k = 5) {
    this.k = k;
    this.name = `recall@${k}`;
  }

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    if (!query.relevantIds || query.relevantIds.length === 0) {
      return { metric: this.name, value: 0, details: { note: "no relevantIds in ground truth" } };
    }

    const relevantSet = new Set(query.relevantIds);
    const topK = execution.results.slice(0, this.k);
    const found = topK.filter((r) => relevantSet.has(r.id)).length;

    return {
      metric: this.name,
      value: found / relevantSet.size,
      details: { found, totalRelevant: relevantSet.size, k: this.k },
    };
  }
}

/**
 * MRR — Mean Reciprocal Rank of the first relevant result.
 */
export class MRR implements Metric {
  readonly name = "mrr";

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    if (!query.relevantIds || query.relevantIds.length === 0) {
      return { metric: this.name, value: 0 };
    }

    const relevantSet = new Set(query.relevantIds);
    for (let i = 0; i < execution.results.length; i++) {
      if (relevantSet.has(execution.results[i].id)) {
        return { metric: this.name, value: 1 / (i + 1), details: { rank: i + 1 } };
      }
    }

    return { metric: this.name, value: 0, details: { rank: null } };
  }
}

/**
 * NDCG@K — Normalized Discounted Cumulative Gain.
 */
export class NDCGAtK implements Metric {
  readonly name: string;
  private k: number;

  constructor(k = 5) {
    this.k = k;
    this.name = `ndcg@${k}`;
  }

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    if (!query.relevantIds || query.relevantIds.length === 0) {
      return { metric: this.name, value: 0 };
    }

    const relevantSet = new Set(query.relevantIds);
    const topK = execution.results.slice(0, this.k);

    // Binary relevance: 1 if relevant, 0 otherwise
    const gains = topK.map((r) => (relevantSet.has(r.id) ? 1 : 0));

    const dcg = gains.reduce((sum: number, gain, i) => sum + gain / Math.log2(i + 2), 0 as number);

    // Ideal: all relevant docs at the top
    const idealCount = Math.min(relevantSet.size, this.k);
    const idcg = Array.from({ length: idealCount }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);

    return {
      metric: this.name,
      value: idcg === 0 ? 0 : dcg / idcg,
      details: { dcg, idcg },
    };
  }
}
