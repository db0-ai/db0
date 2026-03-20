import { describe, it, expect } from "vitest";
import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { db0MemoryTools } from "../src/tools.js";

async function setup() {
  const backend = await createSqliteBackend({ dbPath: ":memory:" });
  const harness = db0.harness({
    agentId: "test",
    sessionId: "s1",
    userId: "u1",
    backend,
    embeddingFn: defaultEmbeddingFn,
    profile: PROFILE_CONVERSATIONAL,
  });
  const tools = db0MemoryTools({ harness });
  return { backend, harness, tools };
}

describe("db0MemoryTools", () => {
  it("exposes three tools", async () => {
    const { tools, harness } = await setup();
    expect(tools.db0_memory_write).toBeDefined();
    expect(tools.db0_memory_search).toBeDefined();
    expect(tools.db0_memory_list).toBeDefined();
    harness.close();
  });

  it("write tool stores a memory", async () => {
    const { tools, harness } = await setup();

    const result = await tools.db0_memory_write.execute(
      { content: "User prefers dark mode", scope: "user", tags: ["preference"] },
      { toolCallId: "tc1", messages: [] as any, abortSignal: undefined as any },
    );

    expect(result.status).toBe("saved");
    expect(result.content).toBe("User prefers dark mode");
    expect(result.scope).toBe("user");
    expect(result.id).toBeDefined();

    harness.close();
  });

  it("search tool finds stored memories", async () => {
    const { tools, harness } = await setup();

    await tools.db0_memory_write.execute(
      { content: "User prefers TypeScript", scope: "user" },
      { toolCallId: "tc1", messages: [] as any, abortSignal: undefined as any },
    );

    const results = await tools.db0_memory_search.execute(
      { query: "language preference", limit: 5 },
      { toolCallId: "tc2", messages: [] as any, abortSignal: undefined as any },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBe("User prefers TypeScript");

    harness.close();
  });

  it("list tool returns all memories", async () => {
    const { tools, harness } = await setup();

    await tools.db0_memory_write.execute(
      { content: "Fact one", scope: "user" },
      { toolCallId: "tc1", messages: [] as any, abortSignal: undefined as any },
    );
    await tools.db0_memory_write.execute(
      { content: "Fact two", scope: "user" },
      { toolCallId: "tc2", messages: [] as any, abortSignal: undefined as any },
    );

    const all = await tools.db0_memory_list.execute(
      {},
      { toolCallId: "tc3", messages: [] as any, abortSignal: undefined as any },
    );

    expect(all.length).toBe(2);

    harness.close();
  });

  it("list tool filters by scope", async () => {
    const { tools, harness } = await setup();

    await tools.db0_memory_write.execute(
      { content: "User fact", scope: "user" },
      { toolCallId: "tc1", messages: [] as any, abortSignal: undefined as any },
    );
    await tools.db0_memory_write.execute(
      { content: "Session fact", scope: "session" },
      { toolCallId: "tc2", messages: [] as any, abortSignal: undefined as any },
    );

    const userOnly = await tools.db0_memory_list.execute(
      { scope: "user" },
      { toolCallId: "tc3", messages: [] as any, abortSignal: undefined as any },
    );

    expect(userOnly.length).toBe(1);
    expect(userOnly[0].content).toBe("User fact");

    harness.close();
  });

  it("write tool supports superseding", async () => {
    const { tools, harness } = await setup();

    const original = await tools.db0_memory_write.execute(
      { content: "User prefers light mode", scope: "user" },
      { toolCallId: "tc1", messages: [] as any, abortSignal: undefined as any },
    );

    await tools.db0_memory_write.execute(
      { content: "User prefers dark mode", scope: "user", supersedes: original.id },
      { toolCallId: "tc2", messages: [] as any, abortSignal: undefined as any },
    );

    const all = await tools.db0_memory_list.execute(
      { scope: "user" },
      { toolCallId: "tc3", messages: [] as any, abortSignal: undefined as any },
    );

    const active = all.filter((m) => m.status === "active");
    const superseded = all.filter((m) => m.status === "superseded");

    expect(active.length).toBe(1);
    expect(active[0].content).toBe("User prefers dark mode");
    expect(superseded.length).toBe(1);

    harness.close();
  });
});
