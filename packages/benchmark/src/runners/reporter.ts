import type { BenchmarkReport } from "../types.js";

/**
 * Format a benchmark report for console output.
 */
export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`═══════════════════════════════════════════════════════`);
  lines.push(`  db0 Benchmark Report`);
  lines.push(`═══════════════════════════════════════════════════════`);
  lines.push(`  Adapter:   ${report.adapter}`);
  lines.push(`  Suite:     ${report.suite}`);
  lines.push(`  Dataset:   ${report.dataset}`);
  lines.push(`  Queries:   ${report.totalQueries}`);
  lines.push(`  Time:      ${(report.totalTimeMs / 1000).toFixed(2)}s`);
  lines.push(`  Timestamp: ${report.timestamp}`);
  lines.push(``);

  // Overall scores
  lines.push(`  ── Overall Scores ──`);
  for (const [metric, value] of Object.entries(report.overall)) {
    lines.push(`  ${padRight(metric, 20)} ${(value * 100).toFixed(1)}%`);
  }
  lines.push(``);

  // Latency
  lines.push(`  ── Latency ──`);
  lines.push(`  p50:  ${report.latency.p50.toFixed(1)}ms`);
  lines.push(`  p95:  ${report.latency.p95.toFixed(1)}ms`);
  lines.push(`  p99:  ${report.latency.p99.toFixed(1)}ms`);
  lines.push(`  mean: ${report.latency.mean.toFixed(1)}ms`);
  lines.push(``);

  // Category breakdown
  if (report.categories.length > 1) {
    lines.push(`  ── By Category ──`);
    for (const cat of report.categories) {
      lines.push(`  ${cat.category} (n=${cat.queryCount}):`);
      for (const [metric, value] of Object.entries(cat.averages)) {
        lines.push(`    ${padRight(metric, 20)} ${(value * 100).toFixed(1)}%`);
      }
    }
    lines.push(``);
  }

  lines.push(`═══════════════════════════════════════════════════════`);
  lines.push(``);

  return lines.join("\n");
}

/**
 * Export report as JSON (for comparison, CI integration, etc.).
 */
export function exportReportJSON(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Compare two reports and show deltas.
 */
export function compareReports(baseline: BenchmarkReport, candidate: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`  ── Comparison: ${baseline.adapter} vs ${candidate.adapter} ──`);
  lines.push(`  ${"Metric".padEnd(20)} ${"Baseline".padStart(10)} ${"Candidate".padStart(10)} ${"Delta".padStart(10)}`);
  lines.push(`  ${"─".repeat(52)}`);

  const allMetrics = new Set([...Object.keys(baseline.overall), ...Object.keys(candidate.overall)]);

  for (const metric of allMetrics) {
    const bVal = baseline.overall[metric] ?? 0;
    const cVal = candidate.overall[metric] ?? 0;
    const delta = cVal - bVal;
    const sign = delta >= 0 ? "+" : "";
    lines.push(
      `  ${metric.padEnd(20)} ${(bVal * 100).toFixed(1).padStart(9)}% ${(cVal * 100).toFixed(1).padStart(9)}% ${(sign + (delta * 100).toFixed(1)).padStart(9)}%`,
    );
  }

  lines.push(``);
  lines.push(`  Latency (p50): ${baseline.latency.p50.toFixed(1)}ms → ${candidate.latency.p50.toFixed(1)}ms`);
  lines.push(``);

  return lines.join("\n");
}

function padRight(s: string, len: number): string {
  return s.padEnd(len);
}
