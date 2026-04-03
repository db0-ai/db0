#!/usr/bin/env node
/**
 * PostQuery hook: triggers db0 memory consolidation after a configurable
 * number of session turns.
 *
 * Maintains a simple counter file alongside the database.
 * When the counter reaches the threshold, runs reconcile() and resets.
 *
 * Environment:
 *   DB0_STORAGE — path to the db0 SQLite file (default: ~/.claude/db0.sqlite)
 *   DB0_AGENT_ID — agent ID (default: "claude-code")
 *   DB0_CONSOLIDATE_EVERY — turns between consolidations (default: 20)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COUNTER_FILE_SUFFIX = ".consolidate-counter";

async function main() {
  const storage =
    process.env.DB0_STORAGE || join(homedir(), ".claude", "db0.sqlite");
  const threshold = parseInt(
    process.env.DB0_CONSOLIDATE_EVERY || "20",
    10,
  );
  const counterPath = storage + COUNTER_FILE_SUFFIX;

  // Read and increment counter
  let count = 0;
  try {
    count = parseInt(readFileSync(counterPath, "utf8").trim(), 10) || 0;
  } catch {
    // File doesn't exist yet — start at 0
  }
  count++;

  if (count < threshold) {
    writeFileSync(counterPath, String(count), "utf8");
    process.exit(0);
  }

  // Reset counter before consolidating (avoid re-triggering on error)
  writeFileSync(counterPath, "0", "utf8");

  try {
    const agentId = process.env.DB0_AGENT_ID || "claude-code";
    const { db0 } = await import("@db0-ai/core");
    const { createSqliteBackend } = await import("@db0-ai/backends-sqlite");

    const backend = createSqliteBackend({ dbPath: storage });
    const harness = db0.harness({
      agentId,
      sessionId: `consolidate-${Date.now()}`,
      backend,
    });

    const result = await harness.context().reconcile();

    if (result.promoted + result.merged + result.consolidated > 0) {
      process.stdout.write(
        `🔄 Auto-consolidation: promoted=${result.promoted}, merged=${result.merged}, consolidated=${result.consolidated}\n`,
      );
    }

    backend.close();
  } catch {
    // Silently fail — consolidation is best-effort
    process.exit(0);
  }
}

main();
