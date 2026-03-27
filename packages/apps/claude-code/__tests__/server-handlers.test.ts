import { describe, it, expect, beforeEach } from "vitest";
import { db0, defaultEmbeddingFn, type Harness } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

/**
 * Tests for the MCP server tool handler logic.
 * We test the db0 operations directly (same as what the MCP handlers call)
 * rather than spinning up the full MCP server, since the transport layer
 * is handled by the MCP SDK.
 */
describe("claude-code plugin: MCP tool handlers", () => {
  let harness: Harness;

  beforeEach(async () => {
    const backend = await createSqliteBackend();
    harness = db0.harness({
      agentId: "claude-code",
      sessionId: "test-session",
      userId: "test-user",
      backend,
    });
  });

  // --- memory_write ---

  it("writes a memory and returns id, scope, summary", async () => {
    const embedding = await defaultEmbeddingFn("User prefers dark mode");
    const entry = await harness.memory().write({
      content: "User prefers dark mode. They find it easier on the eyes.",
      scope: "user",
      embedding,
      tags: ["preference", "ui"],
    });

    expect(entry.id).toBeTruthy();
    expect(entry.scope).toBe("user");
    expect(entry.status).toBe("active");
    expect(entry.summary).toBe("User prefers dark mode.");
    expect(entry.tags).toEqual(["preference", "ui"]);
  });

  it("writes with explicit summary", async () => {
    const embedding = await defaultEmbeddingFn("test");
    const entry = await harness.memory().write({
      content: "Long content about preferences...",
      scope: "user",
      embedding,
      summary: "Custom summary",
    });

    expect(entry.summary).toBe("Custom summary");
  });

  it("supersedes an existing memory", async () => {
    const e1 = await defaultEmbeddingFn("dark mode");
    const old = await harness.memory().write({
      content: "User prefers dark mode.",
      scope: "user",
      embedding: e1,
    });

    const e2 = await defaultEmbeddingFn("light mode");
    const updated = await harness.memory().write({
      content: "User prefers light mode.",
      scope: "user",
      embedding: e2,
      supersedes: old.id,
    });

    expect(updated.status).toBe("active");
    const oldEntry = await harness.memory().get(old.id);
    expect(oldEntry!.status).toBe("superseded");
  });

  // --- memory_search ---

  it("searches memories by embedding", async () => {
    const embedding = await defaultEmbeddingFn("User prefers TypeScript");
    await harness.memory().write({
      content: "User prefers TypeScript over JavaScript.",
      scope: "user",
      embedding,
    });

    const results = await harness.memory().search({
      embedding,
      scope: ["user"],
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].summary).toBeTruthy();
  });

  it("filters search by tags", async () => {
    const e1 = await defaultEmbeddingFn("pref");
    await harness.memory().write({
      content: "User prefers dark mode.",
      scope: "user",
      embedding: e1,
      tags: ["preference"],
    });
    await harness.memory().write({
      content: "Deploy to AWS.",
      scope: "user",
      embedding: e1,
      tags: ["infra"],
    });

    const results = await harness.memory().search({
      embedding: e1,
      scope: ["user"],
      tags: ["preference"],
    });

    expect(results).toHaveLength(1);
    expect(results[0].tags).toContain("preference");
  });

  // --- memory_update ---

  it("updates a memory by searching and superseding", async () => {
    const e1 = await defaultEmbeddingFn("User prefers Python");
    const original = await harness.memory().write({
      content: "User prefers Python",
      scope: "user",
      embedding: e1,
    });

    // Simulate what db0_memory_update does: search for old, supersede, write new
    const oldEmbedding = await defaultEmbeddingFn("User prefers Python");
    const candidates = await harness.memory().search({
      embedding: oldEmbedding,
      scope: ["user"],
      limit: 1,
    });
    expect(candidates.length).toBeGreaterThan(0);

    const newEmbedding = await defaultEmbeddingFn("User prefers TypeScript");
    const updated = await harness.memory().write({
      content: "User prefers TypeScript",
      scope: "user",
      embedding: newEmbedding,
      supersedes: candidates[0].id,
    });

    // Old memory should be superseded
    const oldEntry = await harness.memory().get(original.id);
    expect(oldEntry!.status).toBe("superseded");

    // Search should only return the new one
    const results = await harness.memory().search({
      embedding: newEmbedding,
      scope: ["user"],
      limit: 5,
    });
    const active = results.filter((r) => r.status === "active");
    expect(active.some((r) => r.content === "User prefers TypeScript")).toBe(true);
    expect(active.some((r) => r.content === "User prefers Python")).toBe(false);
  });

  // --- memory_list ---

  it("lists memories by scope", async () => {
    const e = await defaultEmbeddingFn("test");
    await harness.memory().write({ content: "User fact", scope: "user", embedding: e });
    await harness.memory().write({ content: "Agent fact", scope: "agent", embedding: e });

    const userMems = await harness.memory().list("user");
    expect(userMems).toHaveLength(1);
    expect(userMems[0].scope).toBe("user");

    const all = await harness.memory().list();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  // --- memory_get ---

  it("gets a memory by id", async () => {
    const e = await defaultEmbeddingFn("test");
    const entry = await harness.memory().write({
      content: "Remember this fact.",
      scope: "user",
      embedding: e,
    });

    const fetched = await harness.memory().get(entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(entry.id);
    expect(fetched!.content).toBe("Remember this fact.");
  });

  it("returns null for non-existent id", async () => {
    const fetched = await harness.memory().get("non-existent-id");
    expect(fetched).toBeNull();
  });

  // --- memory_delete ---

  it("deletes a memory", async () => {
    const e = await defaultEmbeddingFn("test");
    const entry = await harness.memory().write({
      content: "Temporary fact.",
      scope: "session",
      embedding: e,
    });

    await harness.memory().delete(entry.id);
    const fetched = await harness.memory().get(entry.id);
    expect(fetched).toBeNull();
  });

  // --- memory_stats ---

  it("computes stats by scope and status", async () => {
    const e = await defaultEmbeddingFn("test");
    await harness.memory().write({ content: "User pref 1", scope: "user", embedding: e });
    await harness.memory().write({ content: "User pref 2", scope: "user", embedding: e });
    await harness.memory().write({ content: "Agent note", scope: "agent", embedding: e });

    const all = await harness.memory().list();
    const stats: Record<string, Record<string, number>> = {};
    for (const m of all) {
      if (!stats[m.scope]) stats[m.scope] = {};
      stats[m.scope][m.status] = (stats[m.scope][m.status] ?? 0) + 1;
    }

    expect(stats.user?.active).toBe(2);
    expect(stats.agent?.active).toBe(1);
  });

  // --- state_checkpoint ---

  it("creates and restores a checkpoint", async () => {
    const cp = await harness.state().checkpoint({
      step: 1,
      label: "test-checkpoint",
    });
    expect(cp.step).toBe(1);
    expect(cp.label).toBe("test-checkpoint");

    const restored = await harness.state().restore();
    expect(restored).not.toBeNull();
    expect(restored!.step).toBe(1);
  });

  // --- log_query ---

  it("appends and queries log entries", async () => {
    await harness.log().append({
      event: "test.event",
      level: "info",
      data: { key: "value" },
    });

    const entries = await harness.log().query(10);
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1];
    expect(last.event).toBe("test.event");
  });
});
