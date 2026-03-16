import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteBackend, SqliteBackend } from "../src/index.js";
import { VersionConflictError } from "@db0-ai/core";
import initSqlJs from "sql.js";

describe("SqliteBackend", () => {
  let backend: SqliteBackend;

  beforeEach(async () => {
    backend = await createSqliteBackend();
  });

  afterEach(() => {
    backend.close();
  });

  // === Memory ===

  describe("memory", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("writes and retrieves a memory entry", async () => {
      const entry = await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "User prefers dark mode",
        scope: "user",
        embedding,
        tags: ["preference"],
        metadata: { source: "chat" },
      });

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe("User prefers dark mode");
      expect(entry.scope).toBe("user");
      expect(entry.tags).toEqual(["preference"]);
      expect(entry.accessCount).toBe(0);
      expect(entry.status).toBe("active");
      expect(entry.supersedes).toBeNull();

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe("User prefers dark mode");
    });

    it("searches memories by embedding similarity", async () => {
      await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "User likes TypeScript",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "Working on auth module",
        scope: "user",
        embedding: new Float32Array([0, 1, 0, 0]),
      });

      // Search with query similar to first entry
      const results = await backend.memorySearch(
        "agent-1",
        "session-1",
        "user-1",
        {
          embedding: new Float32Array([0.9, 0.1, 0, 0]),
          scope: "user",
          limit: 5,
          minScore: 0,
        },
      );

      expect(results.length).toBe(2);
      expect(results[0].content).toBe("User likes TypeScript");
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[0].accessCount).toBe(1); // incremented on search
    });

    it("respects minScore filter", async () => {
      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Close match",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Far match",
        scope: "user",
        embedding: new Float32Array([0, 0, 0, 1]),
      });

      const results = await backend.memorySearch(
        "agent-1",
        "session-1",
        "user-1",
        {
          embedding: new Float32Array([1, 0, 0, 0]),
          scope: "user",
          minScore: 0.9,
        },
      );

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Close match");
    });

    it("lists memories by scope", async () => {
      await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "User fact",
        scope: "user",
        embedding,
      });

      await backend.memoryWrite("agent-1", "session-1", null, {
        content: "Task context",
        scope: "task",
        embedding,
      });

      const userMemories = await backend.memoryList("agent-1", "user");
      expect(userMemories.length).toBe(1);
      expect(userMemories[0].content).toBe("User fact");

      const allMemories = await backend.memoryList("agent-1");
      expect(allMemories.length).toBe(2);
    });

    it("deletes a memory", async () => {
      const entry = await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "To be deleted",
        scope: "session",
        embedding,
      });

      await backend.memoryDelete(entry.id);
      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved).toBeNull();
    });

    it("enforces scope visibility in search", async () => {
      // Task-scoped memory for session-1
      await backend.memoryWrite("agent-1", "session-1", null, {
        content: "Session 1 task",
        scope: "task",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      // Task-scoped memory for session-2
      await backend.memoryWrite("agent-1", "session-2", null, {
        content: "Session 2 task",
        scope: "task",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      // Search from session-1 should only see session-1 task memories
      const results = await backend.memorySearch(
        "agent-1",
        "session-1",
        null,
        {
          embedding: new Float32Array([1, 0, 0, 0]),
          scope: "task",
          minScore: 0,
        },
      );

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Session 1 task");
    });

    it("uses null user bucket when searching user scope without userId", async () => {
      await backend.memoryWrite("agent-1", null, null, {
        content: "Anonymous user preference",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });
      await backend.memoryWrite("agent-1", null, "user-2", {
        content: "Named user preference",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      const results = await backend.memorySearch("agent-1", "session-1", null, {
        embedding: new Float32Array([1, 0, 0, 0]),
        scope: "user",
        minScore: 0,
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Anonymous user preference");
    });
  });

  // === Memory Superseding ===

  describe("memory superseding", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("supersedes a memory and marks old as superseded", async () => {
      const original = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers light mode",
        scope: "user",
        embedding,
      });

      const updated = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers dark mode",
        scope: "user",
        embedding,
        supersedes: original.id,
      });

      expect(updated.supersedes).toBe(original.id);
      expect(updated.status).toBe("active");

      const oldEntry = await backend.memoryGet(original.id);
      expect(oldEntry!.status).toBe("superseded");
    });

    it("search excludes superseded by default", async () => {
      const original = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers light mode",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers dark mode",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
        supersedes: original.id,
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding: new Float32Array([1, 0, 0, 0]),
        scope: "user",
        minScore: 0,
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("User prefers dark mode");
    });

    it("search can include superseded with flag", async () => {
      const original = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers light mode",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers dark mode",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
        supersedes: original.id,
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding: new Float32Array([1, 0, 0, 0]),
        scope: "user",
        minScore: 0,
        includeSuperseded: true,
      });

      expect(results.length).toBe(2);
    });

    it("creates a supersedes edge automatically", async () => {
      const original = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Old fact",
        scope: "user",
        embedding,
      });

      const updated = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "New fact",
        scope: "user",
        embedding,
        supersedes: original.id,
      });

      const edges = await backend.memoryGetEdges(updated.id);
      expect(edges.length).toBe(1);
      expect(edges[0].edgeType).toBe("supersedes");
      expect(edges[0].sourceId).toBe(updated.id);
      expect(edges[0].targetId).toBe(original.id);
    });
  });

  // === Structured Content ===

  describe("structured content", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("writes and retrieves structured content", async () => {
      const entry = await backend.memoryWrite("agent-1", null, "user-1", {
        content: { type: "preference", key: "theme", value: "dark" },
        scope: "user",
        embedding,
      });

      expect(entry.content).toEqual({ type: "preference", key: "theme", value: "dark" });

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved!.content).toEqual({ type: "preference", key: "theme", value: "dark" });
    });

    it("plain string content still works", async () => {
      const entry = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Just a plain string",
        scope: "user",
        embedding,
      });

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved!.content).toBe("Just a plain string");
    });
  });

  // === Hybrid Search ===

  describe("hybrid search", () => {
    it("searches with tag filter", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Tagged fact",
        scope: "user",
        embedding,
        tags: ["important", "preference"],
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Untagged fact",
        scope: "user",
        embedding,
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding,
        scope: "user",
        minScore: 0,
        tags: ["important"],
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Tagged fact");
    });

    it("searches with metadata filter", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Chat memory",
        scope: "user",
        embedding,
        metadata: { source: "chat", priority: "high" },
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "API memory",
        scope: "user",
        embedding,
        metadata: { source: "api" },
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding,
        scope: "user",
        minScore: 0,
        metadata: { source: "chat" },
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Chat memory");
    });

    it("searches without embedding (filter-only)", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Important fact",
        scope: "user",
        embedding,
        tags: ["important"],
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Regular fact",
        scope: "user",
        embedding,
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        scope: "user",
        tags: ["important"],
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Important fact");
    });

    it("hybrid scoring returns sub-scores", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "A memory",
        scope: "user",
        embedding,
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding,
        scope: "user",
        minScore: 0,
        scoring: "hybrid",
      });

      expect(results.length).toBe(1);
      expect(results[0].similarityScore).toBeDefined();
      expect(results[0].recencyScore).toBeDefined();
      expect(results[0].popularityScore).toBeDefined();
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("respects custom hybrid weights", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "A memory",
        scope: "user",
        embedding,
      });

      // Default weights: sim=0.7, rec=0.2, pop=0.1
      const defaultResults = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding,
        scope: "user",
        minScore: 0,
        scoring: "hybrid",
      });

      // Custom weights: all similarity
      const simOnlyResults = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding,
        scope: "user",
        minScore: 0,
        scoring: "hybrid",
        hybridWeights: { similarity: 1.0, recency: 0, popularity: 0 },
      });

      // With all weight on similarity, score should equal similarityScore
      expect(simOnlyResults[0].score).toBeCloseTo(simOnlyResults[0].similarityScore!, 5);

      // Custom weights: all recency
      const recOnlyResults = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding,
        scope: "user",
        minScore: 0,
        scoring: "hybrid",
        hybridWeights: { similarity: 0, recency: 1.0, popularity: 0 },
      });

      // Just-created memory should have recency ~1.0
      expect(recOnlyResults[0].score).toBeCloseTo(recOnlyResults[0].recencyScore!, 5);
      expect(recOnlyResults[0].recencyScore!).toBeGreaterThan(0.99);
    });

    it("respects custom decay half-life", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "A memory",
        scope: "user",
        embedding,
      });

      // Very short half-life (0.001 days = ~86 seconds) vs very long (1000 days)
      const shortDecay = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding, scope: "user", minScore: 0,
        scoring: "hybrid",
        hybridWeights: { similarity: 0, recency: 1.0, popularity: 0 },
        decayHalfLifeDays: 1000,
      });

      // With 1000 day half-life, a just-created memory should still be ~1.0
      expect(shortDecay[0].recencyScore!).toBeGreaterThan(0.99);
    });
  });

  // === Memory Edges ===

  describe("memory edges", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("adds and retrieves edges", async () => {
      const m1 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Fact A",
        scope: "user",
        embedding,
      });

      const m2 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Fact B",
        scope: "user",
        embedding,
      });

      const edge = await backend.memoryAddEdge({
        sourceId: m1.id,
        targetId: m2.id,
        edgeType: "related",
        metadata: { reason: "both about preferences" },
      });

      expect(edge.edgeType).toBe("related");
      expect(edge.sourceId).toBe(m1.id);
      expect(edge.targetId).toBe(m2.id);

      const edges = await backend.memoryGetEdges(m1.id);
      expect(edges.length).toBe(1);
      expect(edges[0].edgeType).toBe("related");

      // Also found when querying from target
      const targetEdges = await backend.memoryGetEdges(m2.id);
      expect(targetEdges.length).toBe(1);
    });

    it("deletes edges", async () => {
      const m1 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Fact A",
        scope: "user",
        embedding,
      });

      const m2 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Fact B",
        scope: "user",
        embedding,
      });

      const edge = await backend.memoryAddEdge({
        sourceId: m1.id,
        targetId: m2.id,
        edgeType: "contradicts",
      });

      await backend.memoryDeleteEdge(edge.id);
      const edges = await backend.memoryGetEdges(m1.id);
      expect(edges.length).toBe(0);
    });

    it("cleans up edges when memory is deleted", async () => {
      const m1 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Fact A",
        scope: "user",
        embedding,
      });

      const m2 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Fact B",
        scope: "user",
        embedding,
      });

      await backend.memoryAddEdge({
        sourceId: m1.id,
        targetId: m2.id,
        edgeType: "supports",
      });

      await backend.memoryDelete(m1.id);
      const edges = await backend.memoryGetEdges(m2.id);
      expect(edges.length).toBe(0);
    });
  });

  // === State ===

  describe("state", () => {
    it("creates and restores a checkpoint", async () => {
      await backend.stateCheckpoint("agent-1", "session-1", {
        step: 1,
        label: "after-tool-call",
        metadata: { toolName: "search" },
      });

      await backend.stateCheckpoint("agent-1", "session-1", {
        step: 2,
        label: "after-response",
      });

      const restored = await backend.stateRestore("agent-1", "session-1");
      expect(restored).not.toBeNull();
      expect(restored!.step).toBe(2);
      expect(restored!.label).toBe("after-response");
      expect(restored!.parentCheckpointId).toBeNull();
    });

    it("returns null when no checkpoints exist", async () => {
      const restored = await backend.stateRestore("agent-1", "no-session");
      expect(restored).toBeNull();
    });

    it("lists checkpoints in order", async () => {
      await backend.stateCheckpoint("agent-1", "session-1", { step: 1 });
      await backend.stateCheckpoint("agent-1", "session-1", { step: 2 });
      await backend.stateCheckpoint("agent-1", "session-1", { step: 3 });

      const checkpoints = await backend.stateList("agent-1", "session-1");
      expect(checkpoints.length).toBe(3);
      expect(checkpoints[0].step).toBe(1);
      expect(checkpoints[2].step).toBe(3);
    });
  });

  // === State Branching ===

  describe("state branching", () => {
    it("creates a branch from a checkpoint", async () => {
      const cp1 = await backend.stateCheckpoint("agent-1", "session-1", {
        step: 1,
        label: "base",
      });

      const branch = await backend.stateCheckpoint("agent-1", "session-1", {
        step: 2,
        label: "branch-a",
        parentCheckpointId: cp1.id,
      });

      expect(branch.parentCheckpointId).toBe(cp1.id);
    });

    it("gets a checkpoint by ID", async () => {
      const cp = await backend.stateCheckpoint("agent-1", "session-1", {
        step: 1,
        label: "test",
      });

      const retrieved = await backend.stateGetCheckpoint(cp.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.step).toBe(1);
      expect(retrieved!.label).toBe("test");
    });

    it("returns null for non-existent checkpoint", async () => {
      const retrieved = await backend.stateGetCheckpoint("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  // === Optimistic Concurrency ===

  describe("optimistic concurrency", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("new memories start at version 1", async () => {
      const entry = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "A fact",
        scope: "user",
        embedding,
      });
      expect(entry.version).toBe(1);
    });

    it("superseding increments version", async () => {
      const v1 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "v1 fact",
        scope: "user",
        embedding,
      });

      const v2 = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "v2 fact",
        scope: "user",
        embedding,
        supersedes: v1.id,
      });

      expect(v2.version).toBe(2);
    });

    it("throws VersionConflictError on stale expectedVersion", async () => {
      const original = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Original",
        scope: "user",
        embedding,
      });

      // First supersede succeeds
      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Update 1",
        scope: "user",
        embedding,
        supersedes: original.id,
        expectedVersion: 1,
      });

      // Second supersede with stale version should fail
      await expect(
        backend.memoryWrite("agent-1", null, "user-1", {
          content: "Update 2",
          scope: "user",
          embedding,
          supersedes: original.id,
          expectedVersion: 1,
        }),
      ).rejects.toThrow(VersionConflictError);
    });
  });

  // === Full-Text Search ===

  describe("full-text search", () => {
    it("searches by queryText without embedding", async () => {
      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "The quick brown fox jumps over the lazy dog",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "TypeScript is a typed superset of JavaScript",
        scope: "user",
        embedding: new Float32Array([0, 1, 0, 0]),
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        queryText: "brown fox",
        scope: "user",
        minScore: 0,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain("brown fox");
      expect(results[0].ftsScore).toBeDefined();
    });

    it("RRF scoring merges vector and FTS results", async () => {
      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Kubernetes container orchestration platform",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "Docker container runtime engine",
        scope: "user",
        embedding: new Float32Array([0.8, 0.2, 0, 0]),
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding: new Float32Array([1, 0, 0, 0]),
        queryText: "container",
        scope: "user",
        scoring: "rrf",
        minScore: 0,
      });

      expect(results.length).toBe(2);
      // Both should have scores
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[1].score).toBeGreaterThan(0);
    });
  });

  // === Provenance Fields ===

  describe("provenance fields", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("memoryWrite returns sourceType and extractionMethod when provided", async () => {
      const entry = await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "User likes dark mode",
        scope: "user",
        embedding,
        sourceType: "user_statement",
        extractionMethod: "rules",
      });

      expect(entry.sourceType).toBe("user_statement");
      expect(entry.extractionMethod).toBe("rules");
    });

    it("memoryGet returns provenance fields", async () => {
      const entry = await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "User likes dark mode",
        scope: "user",
        embedding,
        sourceType: "user_statement",
        extractionMethod: "rules",
      });

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sourceType).toBe("user_statement");
      expect(retrieved!.extractionMethod).toBe("rules");
    });

    it("search results include provenance fields", async () => {
      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User likes TypeScript",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
        sourceType: "user_statement",
        extractionMethod: "llm",
      });

      const results = await backend.memorySearch("agent-1", "s1", "user-1", {
        embedding: new Float32Array([1, 0, 0, 0]),
        scope: "user",
        minScore: 0,
      });

      expect(results.length).toBe(1);
      expect(results[0].sourceType).toBe("user_statement");
      expect(results[0].extractionMethod).toBe("llm");
    });

    it("provenance fields default to null when not provided", async () => {
      const entry = await backend.memoryWrite("agent-1", "session-1", "user-1", {
        content: "A plain fact",
        scope: "user",
        embedding,
      });

      expect(entry.sourceType).toBeNull();
      expect(entry.extractionMethod).toBeNull();

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved!.sourceType).toBeNull();
      expect(retrieved!.extractionMethod).toBeNull();
    });
  });

  // === validTo on Supersession ===

  describe("validTo on supersession", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("fresh memory has validTo: null", async () => {
      const entry = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "A fact",
        scope: "user",
        embedding,
      });

      expect(entry.validTo).toBeNull();

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved!.validTo).toBeNull();
    });

    it("superseded memory gets validTo set to a non-null ISO string", async () => {
      const original = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers light mode",
        scope: "user",
        embedding,
      });

      await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers dark mode",
        scope: "user",
        embedding,
        supersedes: original.id,
      });

      const oldEntry = await backend.memoryGet(original.id);
      expect(oldEntry!.validTo).not.toBeNull();
      expect(typeof oldEntry!.validTo).toBe("string");
      // Verify it's a valid ISO date string
      expect(new Date(oldEntry!.validTo!).toISOString()).toBe(oldEntry!.validTo);
    });

    it("new active memory after supersession still has validTo: null", async () => {
      const original = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers light mode",
        scope: "user",
        embedding,
      });

      const updated = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "User prefers dark mode",
        scope: "user",
        embedding,
        supersedes: original.id,
      });

      expect(updated.validTo).toBeNull();

      const retrieved = await backend.memoryGet(updated.id);
      expect(retrieved!.validTo).toBeNull();
    });
  });

  // === Log ===

  describe("log", () => {
    it("appends and queries log entries", async () => {
      await backend.logAppend("agent-1", "session-1", {
        event: "turn.start",
        level: "info",
        data: { messageCount: 1 },
      });

      await backend.logAppend("agent-1", "session-1", {
        event: "tool.call",
        level: "debug",
        data: { tool: "search" },
      });

      const logs = await backend.logQuery("agent-1", "session-1");
      expect(logs.length).toBe(2);
      // Most recent first
      expect(logs[0].event).toBe("tool.call");
      expect(logs[1].event).toBe("turn.start");
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await backend.logAppend("agent-1", "session-1", {
          event: `event-${i}`,
          level: "info",
        });
      }

      const logs = await backend.logQuery("agent-1", "session-1", 2);
      expect(logs.length).toBe(2);
    });

    it("filters by session", async () => {
      await backend.logAppend("agent-1", "session-1", {
        event: "s1-event",
        level: "info",
      });

      await backend.logAppend("agent-1", "session-2", {
        event: "s2-event",
        level: "info",
      });

      const logs = await backend.logQuery("agent-1", "session-1");
      expect(logs.length).toBe(1);
      expect(logs[0].event).toBe("s1-event");
    });
  });
});

// === Schema Migration v4→v5 ===

describe("schema migration v4→v5", () => {
  it("migrates a v4 database by adding source_type, extraction_method, and valid_to columns", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // Create a v4-era schema: same as v5 but WITHOUT source_type, extraction_method, valid_to
    db.run(`
      CREATE TABLE IF NOT EXISTS db0_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS db0_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        user_id TEXT,
        content TEXT NOT NULL,
        summary TEXT,
        scope TEXT NOT NULL,
        embedding BLOB NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        supersedes_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS db0_memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS db0_state (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        step INTEGER NOT NULL,
        label TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        parent_checkpoint_id TEXT
      );

      CREATE TABLE IF NOT EXISTS db0_log (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event TEXT NOT NULL,
        level TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);

    // Mark as schema version 4
    db.run("INSERT INTO db0_meta (key, value) VALUES ('schema_version', '4')");

    // Insert a v4-era memory row (no provenance columns)
    const embeddingBuf = Buffer.from(new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer);
    db.run(
      `INSERT INTO db0_memory (id, agent_id, session_id, user_id, content, scope, embedding, tags, metadata, created_at, supersedes_id, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["old-memory-1", "agent-1", null, "user-1", "Existing fact", "user", embeddingBuf as any, "[]", "{}", "2025-01-01T00:00:00.000Z", null, "active", 1],
    );

    // Export the v4 database to a buffer, then re-open via createSqliteBackend
    // We need to write it to a temp file
    const tmpPath = `/tmp/db0-test-migration-${Date.now()}.sqlite`;
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const data = db.export();
    writeFileSync(tmpPath, Buffer.from(data));
    db.close();

    // Now open with createSqliteBackend which should run migration
    const backend = await createSqliteBackend({ dbPath: tmpPath });

    try {
      // Verify existing data survived
      const oldMemory = await backend.memoryGet("old-memory-1");
      expect(oldMemory).not.toBeNull();
      expect(oldMemory!.content).toBe("Existing fact");
      expect(oldMemory!.status).toBe("active");

      // Verify new columns exist with null defaults
      expect(oldMemory!.sourceType).toBeNull();
      expect(oldMemory!.extractionMethod).toBeNull();
      expect(oldMemory!.validTo).toBeNull();

      // Verify we can write new entries with the provenance fields
      const newEntry = await backend.memoryWrite("agent-1", null, "user-1", {
        content: "New fact with provenance",
        scope: "user",
        embedding: new Float32Array([0.1, 0.2, 0.3, 0.4]),
        sourceType: "user_statement",
        extractionMethod: "rules",
      });

      expect(newEntry.sourceType).toBe("user_statement");
      expect(newEntry.extractionMethod).toBe("rules");

      const retrieved = await backend.memoryGet(newEntry.id);
      expect(retrieved!.sourceType).toBe("user_statement");
      expect(retrieved!.extractionMethod).toBe("rules");
    } finally {
      backend.close();
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  });
});
