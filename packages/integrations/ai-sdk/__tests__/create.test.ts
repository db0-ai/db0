import { describe, it, expect } from "vitest";
import { createDb0 } from "../src/create.js";

describe("createDb0", () => {
  it("creates an instance with middleware, tools, and harness", async () => {
    const memory = await createDb0({ dbPath: ":memory:" });

    expect(memory.middleware).toBeDefined();
    expect(memory.middleware.specificationVersion).toBe("v3");
    expect(memory.middleware.transformParams).toBeDefined();
    expect(memory.middleware.wrapGenerate).toBeDefined();

    expect(memory.tools).toBeDefined();
    expect(memory.tools.db0_memory_write).toBeDefined();
    expect(memory.tools.db0_memory_search).toBeDefined();
    expect(memory.tools.db0_memory_list).toBeDefined();

    expect(memory.harness).toBeDefined();
    expect(memory.harness.agentId).toBe("ai-sdk");

    memory.close();
  });

  it("accepts custom agentId and userId", async () => {
    const memory = await createDb0({
      dbPath: ":memory:",
      agentId: "my-bot",
      userId: "user-42",
    });

    expect(memory.harness.agentId).toBe("my-bot");
    expect(memory.harness.userId).toBe("user-42");

    memory.close();
  });

  it("newSession creates a fresh harness with same backend", async () => {
    const memory = await createDb0({ dbPath: ":memory:" });

    const firstSessionId = memory.harness.sessionId;
    const newHarness = memory.newSession("session-2");

    expect(newHarness.sessionId).toBe("session-2");
    expect(newHarness.sessionId).not.toBe(firstSessionId);
    // Same agentId and userId
    expect(newHarness.agentId).toBe("ai-sdk");

    memory.close();
  });

  it("accepts a pre-configured backend", async () => {
    const { createSqliteBackend } = await import("@db0-ai/backends-sqlite");
    const backend = await createSqliteBackend({ dbPath: ":memory:" });

    const memory = await createDb0({ backend });

    expect(memory.harness).toBeDefined();

    // Write a memory and verify it persists
    await memory.tools.db0_memory_write.execute(
      { content: "test fact", scope: "user" },
      { toolCallId: "tc1", messages: [] as any, abortSignal: undefined as any },
    );

    const list = await memory.tools.db0_memory_list.execute(
      {},
      { toolCallId: "tc2", messages: [] as any, abortSignal: undefined as any },
    );
    expect(list.length).toBe(1);

    memory.close();
  });
});
