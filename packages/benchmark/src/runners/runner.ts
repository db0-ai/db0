import type {
  MemoryAdapter,
  Metric,
  BenchmarkDataset,
  BenchmarkReport,
  QueryResult,
  CategoryResult,
} from "../types.js";

export interface RunnerOptions {
  adapter: MemoryAdapter;
  dataset: BenchmarkDataset;
  metrics: Metric[];
  /** Max results per query. Default: 10. */
  queryLimit?: number;
  /** Progress callback. */
  onProgress?: (completed: number, total: number, queryId: string) => void;
}

/**
 * Core benchmark runner.
 *
 * Pipeline: setup → ingest sessions → evaluate queries → teardown → report
 */
export async function runBenchmark(opts: RunnerOptions): Promise<BenchmarkReport> {
  const { adapter, dataset, metrics, queryLimit = 10, onProgress } = opts;
  const totalStart = performance.now();

  // 1. Setup
  await adapter.setup();

  // 2. Ingest all sessions
  for (const session of dataset.sessions) {
    await adapter.ingest(session);
  }

  // 3. Evaluate queries
  const queryResults: QueryResult[] = [];

  for (let i = 0; i < dataset.queries.length; i++) {
    const query = dataset.queries[i];
    const execution = await adapter.query(query.query, queryLimit);
    execution.queryId = query.id;

    const scores = await Promise.all(metrics.map((m) => m.evaluate(execution, query)));

    queryResults.push({
      queryId: query.id,
      query: query.query,
      category: query.category,
      scores,
      latencyMs: execution.latencyMs,
      retrievedCount: execution.results.length,
    });

    onProgress?.(i + 1, dataset.queries.length, query.id);
  }

  // 4. Teardown
  await adapter.teardown();

  // 5. Compute aggregates
  const overall = computeOverallAverages(queryResults, metrics);
  const categories = computeCategoryBreakdown(queryResults, metrics);
  const latency = computeLatencyStats(queryResults);

  return {
    adapter: adapter.name,
    suite: dataset.name,
    dataset: dataset.name,
    timestamp: new Date().toISOString(),
    totalQueries: queryResults.length,
    overall,
    categories,
    queries: queryResults,
    latency,
    totalTimeMs: performance.now() - totalStart,
  };
}

function computeOverallAverages(results: QueryResult[], metrics: Metric[]): Record<string, number> {
  const averages: Record<string, number> = {};

  for (const metric of metrics) {
    const values = results
      .map((r) => r.scores.find((s) => s.metric === metric.name)?.value)
      .filter((v): v is number => v !== undefined);

    averages[metric.name] = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  }

  return averages;
}

function computeCategoryBreakdown(results: QueryResult[], metrics: Metric[]): CategoryResult[] {
  const grouped = new Map<string, QueryResult[]>();

  for (const result of results) {
    const cat = result.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(result);
  }

  return Array.from(grouped.entries()).map(([category, catResults]) => ({
    category,
    queryCount: catResults.length,
    averages: computeOverallAverages(catResults, metrics),
  }));
}

function computeLatencyStats(results: QueryResult[]): BenchmarkReport["latency"] {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  if (latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0, mean: 0 };
  }

  return {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
