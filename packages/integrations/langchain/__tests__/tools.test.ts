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
  return { harness, tools };
}

describe("db0MemoryTools (LangChain)", () => {
  it("returns three tools", async () => {
    const { tools, harness } = await setup();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "db0_memory_write",
      "db0_memory_search",
      "db0_memory_list",
    ]);
    harness.close();
  });

  it("write tool stores a memory", async () => {
    const { tools, harness } = await setup();
    const writeTool = tools.find((t) => t.name === "db0_memory_write")!;

    const result = await writeTool.invoke({
      content: "User prefers dark mode",
      scope: "user",
      tags: ["preference"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("saved");
    expect(parsed.content).toBe("User prefers dark mode");
    harness.close();
  });

  it("search tool finds stored memories", async () => {
    const { tools, harness } = await setup();
    const writeTool = tools.find((t) => t.name === "db0_memory_write")!;
    const searchTool = tools.find((t) => t.name === "db0_memory_search")!;

    await writeTool.invoke({ content: "User prefers TypeScript", scope: "user" });

    const result = await searchTool.invoke({ query: "User prefers TypeScript", limit: 5 });
    const parsed = JSON.parse(result);

    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].content).toBe("User prefers TypeScript");
    harness.close();
  });

  it("list tool returns all memories", async () => {
    const { tools, harness } = await setup();
    const writeTool = tools.find((t) => t.name === "db0_memory_write")!;
    const listTool = tools.find((t) => t.name === "db0_memory_list")!;

    await writeTool.invoke({ content: "Fact one", scope: "user" });
    await writeTool.invoke({ content: "Fact two", scope: "user" });

    const result = await listTool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    harness.close();
  });

  it("write tool supports superseding", async () => {
    const { tools, harness } = await setup();
    const writeTool = tools.find((t) => t.name === "db0_memory_write")!;
    const listTool = tools.find((t) => t.name === "db0_memory_list")!;

    const original = JSON.parse(
      await writeTool.invoke({ content: "User prefers light mode", scope: "user" }),
    );

    await writeTool.invoke({
      content: "User prefers dark mode",
      scope: "user",
      supersedes: original.id,
    });

    const all = JSON.parse(await listTool.invoke({ scope: "user" }));
    const active = all.filter((m: any) => m.status === "active");
    const superseded = all.filter((m: any) => m.status === "superseded");

    expect(active).toHaveLength(1);
    expect(active[0].content).toBe("User prefers dark mode");
    expect(superseded).toHaveLength(1);
    harness.close();
  });
});
