import type { Metric, MetricScore, QueryExecution, BenchmarkQuery } from "../types.js";
import { scoreMrNiah, decomposeLabel } from "../suites/mr-niah.js";

/**
 * MR-NIAH Score — key-phrase substring match metric.
 *
 * Ported from MiniMax's official scoring script. Checks whether the generated
 * answer contains each key phrase from the ground-truth label (case-sensitive).
 * Score = fraction of key phrases found.
 *
 * For memory systems: the "generated answer" is typically the retrieved content
 * concatenated, or an LLM answer generated from retrieved context.
 */
export class MrNiahScoreMetric implements Metric {
  readonly name = "mr_niah_score";

  async evaluate(execution: QueryExecution, query: BenchmarkQuery): Promise<MetricScore> {
    const prediction = execution.generatedAnswer ?? "";
    const label = query.expectedAnswer;
    const language = query.metadata?.language as string | undefined;

    const score = scoreMrNiah(prediction, label, language);
    const phrases = decomposeLabel(label);
    const matched = phrases.filter((p) => prediction.includes(p));

    return {
      metric: this.name,
      value: score,
      details: {
        matched: matched.length,
        total: phrases.length,
        matchedPhrases: matched,
        missedPhrases: phrases.filter((p) => !prediction.includes(p)),
      },
    };
  }
}
