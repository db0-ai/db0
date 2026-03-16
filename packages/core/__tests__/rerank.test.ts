import { describe, it, expect } from "vitest";
import { Memory } from "../src/components/memory.js";
import type { Db0Backend, MemorySearchResult } from "../src/types.js";

function makeMockResult(id: string, score: number): MemorySearchResult {
  return {
    id,
    agentId: "test",
    sessionId: null,
    userId: null,
    content: `memory ${id}`,
    scope: "user",
    embedding: new Float32Array([0]),
    tags: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    accessCount: 0,
    supersedes: null,
    status: "active",
    version: 1,
    score,
  };
}

function makeMockBackend(results: MemorySearchResult[]): Db0Backend {
  return {
    memorySearch: async () => results,
    memoryWrite: async () => results[0],
    memoryList: async () => [],
    memoryDelete: async () => {},
    memoryGet: async () => null,
    memoryAddEdge: async () => ({ id: "", sourceId: "", targetId: "", edgeType: "related" as const, metadata: {}, createdAt: "" }),
    memoryGetEdges: async () => [],
    memoryDeleteEdge: async () => {},
    stateCheckpoint: async () => ({ id: "", agentId: "", sessionId: "", step: 0, label: null, metadata: {}, createdAt: "", parentCheckpointId: null }),
    stateRestore: async () => null,
    stateList: async () => [],
    stateGetCheckpoint: async () => null,
    logAppend: async () => ({ id: "", agentId: "", sessionId: "", event: "", level: "", data: {}, createdAt: "" }),
    logQuery: async () => [],
    close: () => {},
  };
}

describe("Memory.search with rerankFn", () => {
  it("applies rerankFn to reorder results", async () => {
    const results = [
      makeMockResult("a", 0.9),
      makeMockResult("b", 0.8),
      makeMockResult("c", 0.7),
    ];

    const memory = new Memory(makeMockBackend(results), "agent", "sess", null);

    const reranked = await memory.search({
      queryText: "test query",
      embedding: new Float32Array([0]),
      rerankFn: async (_query, candidates) => [...candidates].reverse(),
    });

    expect(reranked.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("skips reranking when no queryText", async () => {
    const results = [makeMockResult("a", 0.9), makeMockResult("b", 0.8)];
    const memory = new Memory(makeMockBackend(results), "agent", "sess", null);

    let rerankCalled = false;
    const reranked = await memory.search({
      embedding: new Float32Array([0]),
      rerankFn: async (_q, c) => { rerankCalled = true; return c; },
    });

    expect(rerankCalled).toBe(false);
    expect(reranked.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("works without rerankFn (default behavior)", async () => {
    const results = [makeMockResult("a", 0.9)];
    const memory = new Memory(makeMockBackend(results), "agent", "sess", null);

    const found = await memory.search({
      queryText: "test",
      embedding: new Float32Array([0]),
    });

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("a");
  });
});
