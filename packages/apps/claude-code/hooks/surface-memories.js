#!/usr/bin/env node
/**
 * PreQuery hook: surfaces relevant db0 memories before each user query.
 *
 * Reads the user's message from stdin (Claude Code hook protocol),
 * runs a semantic search against db0, and prints any relevant memories
 * so the assistant sees them as context.
 *
 * Environment:
 *   DB0_STORAGE — path to the db0 SQLite file (default: ~/.claude/db0.sqlite)
 *   DB0_AGENT_ID — agent ID (default: "claude-code")
 *   DB0_SURFACE_LIMIT — max memories to surface (default: 3)
 *   DB0_SURFACE_THRESHOLD — minimum score to surface (default: 0.3)
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

async function main() {
  let input;
  try {
    input = JSON.parse(readFileSync("/dev/stdin", "utf8"));
  } catch {
    // No stdin or invalid JSON — nothing to do
    process.exit(0);
  }

  const message = input?.message ?? input?.query ?? "";
  if (!message || typeof message !== "string" || message.trim().length < 10) {
    // Too short to meaningfully search
    process.exit(0);
  }

  const storage =
    process.env.DB0_STORAGE || join(homedir(), ".claude", "db0.sqlite");
  const agentId = process.env.DB0_AGENT_ID || "claude-code";
  const limit = parseInt(process.env.DB0_SURFACE_LIMIT || "3", 10);
  const threshold = parseFloat(process.env.DB0_SURFACE_THRESHOLD || "0.3");

  try {
    const { db0, defaultEmbeddingFn, memoryAge } = await import("@db0-ai/core");
    const { createSqliteBackend } = await import("@db0-ai/backends-sqlite");

    const backend = createSqliteBackend({ dbPath: storage });
    const harness = db0.harness({
      agentId,
      sessionId: `surface-${Date.now()}`,
      backend,
    });

    const embedding = await defaultEmbeddingFn(message);
    const results = await harness.memory().search({
      embedding,
      scope: ["user", "agent"],
      limit,
      includeSuperseded: false,
    });

    const relevant = results.filter((r) => r.score >= threshold);
    if (relevant.length === 0) {
      backend.close();
      process.exit(0);
    }

    const lines = relevant.map((r) => {
      const age = memoryAge(r.createdAt);
      const content =
        typeof r.content === "string" ? r.content : JSON.stringify(r.content);
      const caveat = age.stalenessCaveat ? ` ⚠️ ${age.stalenessCaveat}` : "";
      return `- [${r.scope}] ${content} (score: ${Math.round(r.score * 100)}%, ${age.label})${caveat}`;
    });

    process.stdout.write(
      `\n📝 Relevant memories from db0:\n${lines.join("\n")}\n`,
    );

    backend.close();
  } catch {
    // Silently fail — the hook should never block the user
    process.exit(0);
  }
}

main();
