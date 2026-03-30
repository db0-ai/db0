import { describe, it, expect, vi } from "vitest";
import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "../src/index.js";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import type { ConsolidateFn } from "../src/types.js";

async function setup(consolidateFn?: ConsolidateFn) {
  const backend = await createSqliteBackend({ dbPath: ":memory:" });
  const harness = db0.harness({
    agentId: "test",
    sessionId: "s1",
    userId: "u1",
    backend,
    embeddingFn: defaultEmbeddingFn,
    profile: PROFILE_CONVERSATIONAL,
    consolidateFn,
  });
  return { backend, harness };
}

describe("Memory consolidation", () => {
  it("reconcile() returns consolidated: 0 without consolidateFn", async () => {
    const { harness } = await setup();

    const embedding = await defaultEmbeddingFn("test");
    await harness.memory().write({ content: "Fact A", scope: "user", embedding });
    await harness.memory().write({ content: "Fact B", scope: "user", embedding });

    const result = await harness.context().reconcile();
    expect(result.consolidated).toBe(0);
    expect(result.consolidatedMemories).toBe(0);

    harness.close();
  });

  it("reconcile() clusters and merges with consolidateFn", async () => {
    const mockConsolidate: ConsolidateFn = vi.fn(async (memories) => ({
      content: memories.map((m) => m.content).join(" + "),
    }));

    const { harness } = await setup(mockConsolidate);

    // Write two very similar memories (same embedding = similarity 1.0)
    const embedding = await defaultEmbeddingFn("user preference typescript");
    await harness.memory().write({
      content: "User prefers TypeScript",
      scope: "user",
      embedding,
      tags: ["preference"],
    });
    await harness.memory().write({
      content: "User always uses TypeScript",
      scope: "user",
      embedding,
      tags: ["preference"],
    });

    const result = await harness.context().reconcile();

    // consolidateFn should have been called
    expect(mockConsolidate).toHaveBeenCalledTimes(1);
    expect(result.consolidated).toBe(1);
    expect(result.consolidatedMemories).toBe(2);

    // The merged memory should exist
    const active = (await harness.memory().list("user")).filter(
      (m) => m.status === "active",
    );
    expect(active.length).toBe(1);
    expect(active[0].content).toContain("+");
    expect(active[0].extractionMethod).toBe("consolidate");
    expect(active[0].metadata?.mergedFrom).toBeDefined();

    harness.close();
  });

  it("does not consolidate clusters below minClusterSize", async () => {
    const mockConsolidate: ConsolidateFn = vi.fn(async (memories) => ({
      content: "merged",
    }));

    const { harness } = await setup(mockConsolidate);

    // Write one memory — cluster size 1, below default threshold of 2
    const embedding = await defaultEmbeddingFn("unique fact");
    await harness.memory().write({
      content: "Only one fact about this topic",
      scope: "user",
      embedding,
    });

    const result = await harness.context().reconcile();
    expect(mockConsolidate).not.toHaveBeenCalled();
    expect(result.consolidated).toBe(0);

    harness.close();
  });

  it("handles consolidateFn errors gracefully", async () => {
    const failingConsolidate: ConsolidateFn = vi.fn(async () => {
      throw new Error("LLM failed");
    });

    const { harness } = await setup(failingConsolidate);

    const embedding = await defaultEmbeddingFn("test");
    await harness.memory().write({ content: "Fact A", scope: "user", embedding });
    await harness.memory().write({ content: "Fact B", scope: "user", embedding });

    // Should not throw — errors are caught per-cluster
    const result = await harness.context().reconcile();
    expect(result.consolidated).toBe(0);

    // Original memories should still be active
    const active = (await harness.memory().list("user")).filter(
      (m) => m.status === "active",
    );
    expect(active.length).toBe(2);

    harness.close();
  });

  it("consolidated memory has audit trail metadata", async () => {
    const mockConsolidate: ConsolidateFn = vi.fn(async (memories) => ({
      content: "Consolidated: " + memories.map((m) => m.content).join(", "),
    }));

    const { harness } = await setup(mockConsolidate);

    // Same embedding → clusters together, different content → not exact-deduped
    const embedding = await defaultEmbeddingFn("user typescript preference");
    await harness.memory().write({ content: "User likes TypeScript", scope: "user", embedding });
    await harness.memory().write({ content: "User uses strict mode", scope: "user", embedding });

    await harness.context().reconcile();

    // A consolidated memory should exist with mergedFrom metadata
    const all = await harness.memory().list("user");
    const consolidated = all.filter(
      (m) => m.status === "active" && m.extractionMethod === "consolidate",
    );
    expect(consolidated.length).toBe(1);
    expect(consolidated[0].content).toContain("Consolidated");
    expect(consolidated[0].metadata?.mergedFrom).toBeDefined();
    expect((consolidated[0].metadata?.mergedFrom as string[]).length).toBe(2);
    expect(consolidated[0].metadata?.consolidatedAt).toBeDefined();

    harness.close();
  });
});
