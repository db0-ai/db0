import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPostgresBackend, PostgresBackend } from "../src/index.js";

const CONNECTION_STRING = process.env.DB0_POSTGRES_URL;

// Skip all tests if no Postgres connection string is provided
const describeWithDb = CONNECTION_STRING ? describe : describe.skip;

describeWithDb("PostgresBackend", () => {
  let backend: PostgresBackend;

  beforeAll(async () => {
    backend = await createPostgresBackend({
      connectionString: CONNECTION_STRING!,
      dimensions: 4, // small for tests
    });
  });

  afterAll(async () => {
    if (backend) {
      // Clean up test data
      const pool = (backend as unknown as { pool: { query: (sql: string) => Promise<void>; end: () => Promise<void> } }).pool;
      await pool.query("DELETE FROM db0_memory_edges");
      await pool.query("DELETE FROM db0_memory WHERE agent_id LIKE 'test-%'");
      await pool.query("DELETE FROM db0_state WHERE agent_id LIKE 'test-%'");
      await pool.query("DELETE FROM db0_log WHERE agent_id LIKE 'test-%'");
      backend.close();
    }
  });

  // === Memory ===

  describe("memory", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("writes and retrieves a memory entry", async () => {
      const entry = await backend.memoryWrite(
        "test-agent-1",
        "session-1",
        "user-1",
        {
          content: "User prefers dark mode",
          scope: "user",
          embedding,
          tags: ["preference"],
          metadata: { source: "chat" },
        },
      );

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe("User prefers dark mode");
      expect(entry.scope).toBe("user");
      expect(entry.tags).toEqual(["preference"]);
      expect(entry.status).toBe("active");
      expect(entry.supersedes).toBeNull();

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe("User prefers dark mode");
    });

    it("searches memories using pgvector cosine similarity", async () => {
      await backend.memoryWrite("test-agent-2", null, "user-1", {
        content: "User likes TypeScript",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("test-agent-2", null, "user-1", {
        content: "Working on auth module",
        scope: "user",
        embedding: new Float32Array([0, 1, 0, 0]),
      });

      const results = await backend.memorySearch(
        "test-agent-2",
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
    });

    it("respects minScore filter", async () => {
      await backend.memoryWrite("test-agent-3", null, "user-1", {
        content: "Close match",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("test-agent-3", null, "user-1", {
        content: "Far match",
        scope: "user",
        embedding: new Float32Array([0, 0, 0, 1]),
      });

      const results = await backend.memorySearch(
        "test-agent-3",
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

    it("enforces scope visibility in search", async () => {
      await backend.memoryWrite("test-agent-4", "session-1", null, {
        content: "Session 1 task",
        scope: "task",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("test-agent-4", "session-2", null, {
        content: "Session 2 task",
        scope: "task",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      const results = await backend.memorySearch(
        "test-agent-4",
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
      await backend.memoryWrite("test-agent-6", null, null, {
        content: "Anonymous user preference",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });
      await backend.memoryWrite("test-agent-6", null, "user-2", {
        content: "Named user preference",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      const results = await backend.memorySearch("test-agent-6", "session-1", null, {
        embedding: new Float32Array([1, 0, 0, 0]),
        scope: "user",
        minScore: 0,
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Anonymous user preference");
    });

    it("deletes a memory", async () => {
      const entry = await backend.memoryWrite(
        "test-agent-5",
        "session-1",
        null,
        {
          content: "To be deleted",
          scope: "session",
          embedding,
        },
      );

      await backend.memoryDelete(entry.id);
      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved).toBeNull();
    });
  });

  // === Memory Superseding ===

  describe("memory superseding", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("supersedes a memory and marks old as superseded", async () => {
      const original = await backend.memoryWrite("test-sup-1", null, "user-1", {
        content: "User prefers light mode",
        scope: "user",
        embedding,
      });

      const updated = await backend.memoryWrite("test-sup-1", null, "user-1", {
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
      const original = await backend.memoryWrite("test-sup-2", null, "user-1", {
        content: "Old preference",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
      });

      await backend.memoryWrite("test-sup-2", null, "user-1", {
        content: "New preference",
        scope: "user",
        embedding: new Float32Array([1, 0, 0, 0]),
        supersedes: original.id,
      });

      const results = await backend.memorySearch("test-sup-2", "s1", "user-1", {
        embedding: new Float32Array([1, 0, 0, 0]),
        scope: "user",
        minScore: 0,
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("New preference");
    });

    it("creates a supersedes edge automatically", async () => {
      const original = await backend.memoryWrite("test-sup-3", null, "user-1", {
        content: "Old fact",
        scope: "user",
        embedding,
      });

      const updated = await backend.memoryWrite("test-sup-3", null, "user-1", {
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
      const entry = await backend.memoryWrite("test-struct-1", null, "user-1", {
        content: { type: "preference", key: "theme", value: "dark" },
        scope: "user",
        embedding,
      });

      expect(entry.content).toEqual({ type: "preference", key: "theme", value: "dark" });

      const retrieved = await backend.memoryGet(entry.id);
      expect(retrieved!.content).toEqual({ type: "preference", key: "theme", value: "dark" });
    });
  });

  // === Hybrid Search ===

  describe("hybrid search", () => {
    it("searches with tag filter", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("test-hyb-1", null, "user-1", {
        content: "Tagged fact",
        scope: "user",
        embedding,
        tags: ["important", "preference"],
      });

      await backend.memoryWrite("test-hyb-1", null, "user-1", {
        content: "Untagged fact",
        scope: "user",
        embedding,
      });

      const results = await backend.memorySearch("test-hyb-1", "s1", "user-1", {
        embedding,
        scope: "user",
        minScore: 0,
        tags: ["important"],
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Tagged fact");
    });

    it("searches without embedding (filter-only)", async () => {
      const embedding = new Float32Array([1, 0, 0, 0]);

      await backend.memoryWrite("test-hyb-2", null, "user-1", {
        content: "Important fact",
        scope: "user",
        embedding,
        tags: ["important"],
      });

      await backend.memoryWrite("test-hyb-2", null, "user-1", {
        content: "Regular fact",
        scope: "user",
        embedding,
      });

      const results = await backend.memorySearch("test-hyb-2", "s1", "user-1", {
        scope: "user",
        tags: ["important"],
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe("Important fact");
    });
  });

  // === Memory Edges ===

  describe("memory edges", () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    it("adds and retrieves edges", async () => {
      const m1 = await backend.memoryWrite("test-edge-1", null, "user-1", {
        content: "Fact A",
        scope: "user",
        embedding,
      });

      const m2 = await backend.memoryWrite("test-edge-1", null, "user-1", {
        content: "Fact B",
        scope: "user",
        embedding,
      });

      const edge = await backend.memoryAddEdge({
        sourceId: m1.id,
        targetId: m2.id,
        edgeType: "related",
      });

      expect(edge.edgeType).toBe("related");
      const edges = await backend.memoryGetEdges(m1.id);
      expect(edges.length).toBe(1);
    });

    it("deletes edges", async () => {
      const m1 = await backend.memoryWrite("test-edge-2", null, "user-1", {
        content: "Fact A",
        scope: "user",
        embedding,
      });

      const m2 = await backend.memoryWrite("test-edge-2", null, "user-1", {
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
  });

  // === State ===

  describe("state", () => {
    it("creates and restores a checkpoint", async () => {
      await backend.stateCheckpoint("test-agent-s1", "session-1", {
        step: 1,
        label: "after-tool-call",
        metadata: { toolName: "search" },
      });

      await backend.stateCheckpoint("test-agent-s1", "session-1", {
        step: 2,
        label: "after-response",
      });

      const restored = await backend.stateRestore(
        "test-agent-s1",
        "session-1",
      );
      expect(restored).not.toBeNull();
      expect(restored!.step).toBe(2);
      expect(restored!.label).toBe("after-response");
      expect(restored!.parentCheckpointId).toBeNull();
    });

    it("returns null when no checkpoints exist", async () => {
      const restored = await backend.stateRestore(
        "test-agent-s2",
        "no-session",
      );
      expect(restored).toBeNull();
    });

    it("lists checkpoints in order", async () => {
      await backend.stateCheckpoint("test-agent-s3", "session-1", { step: 1 });
      await backend.stateCheckpoint("test-agent-s3", "session-1", { step: 2 });
      await backend.stateCheckpoint("test-agent-s3", "session-1", { step: 3 });

      const checkpoints = await backend.stateList(
        "test-agent-s3",
        "session-1",
      );
      expect(checkpoints.length).toBe(3);
      expect(checkpoints[0].step).toBe(1);
      expect(checkpoints[2].step).toBe(3);
    });
  });

  // === State Branching ===

  describe("state branching", () => {
    it("creates a branch from a checkpoint", async () => {
      const cp1 = await backend.stateCheckpoint("test-branch-1", "session-1", {
        step: 1,
        label: "base",
      });

      const branch = await backend.stateCheckpoint("test-branch-1", "session-1", {
        step: 2,
        label: "branch-a",
        parentCheckpointId: cp1.id,
      });

      expect(branch.parentCheckpointId).toBe(cp1.id);
    });

    it("gets a checkpoint by ID", async () => {
      const cp = await backend.stateCheckpoint("test-branch-2", "session-1", {
        step: 1,
        label: "test",
      });

      const retrieved = await backend.stateGetCheckpoint(cp.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.step).toBe(1);
      expect(retrieved!.label).toBe("test");
    });
  });

  // === Log ===

  describe("log", () => {
    it("appends and queries log entries", async () => {
      await backend.logAppend("test-agent-l1", "session-1", {
        event: "turn.start",
        level: "info",
        data: { messageCount: 1 },
      });

      await backend.logAppend("test-agent-l1", "session-1", {
        event: "tool.call",
        level: "debug",
        data: { tool: "search" },
      });

      const logs = await backend.logQuery("test-agent-l1", "session-1");
      expect(logs.length).toBe(2);
      expect(logs[0].event).toBe("tool.call");
      expect(logs[1].event).toBe("turn.start");
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await backend.logAppend("test-agent-l2", "session-1", {
          event: `event-${i}`,
          level: "info",
        });
      }

      const logs = await backend.logQuery("test-agent-l2", "session-1", 2);
      expect(logs.length).toBe(2);
    });

    it("filters by session", async () => {
      await backend.logAppend("test-agent-l3", "session-1", {
        event: "s1-event",
        level: "info",
      });

      await backend.logAppend("test-agent-l3", "session-2", {
        event: "s2-event",
        level: "info",
      });

      const logs = await backend.logQuery("test-agent-l3", "session-1");
      expect(logs.length).toBe(1);
      expect(logs[0].event).toBe("s1-event");
    });
  });
});
