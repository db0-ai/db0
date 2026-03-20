import { describe, it, expect } from "vitest";
import { createDb0 } from "../src/create.js";

describe("createDb0 (LangChain)", () => {
  it("creates an instance with tools, chatHistory, and harness", async () => {
    const memory = await createDb0({ dbPath: ":memory:" });

    expect(memory.tools).toHaveLength(3);
    expect(memory.chatHistory).toBeDefined();
    expect(memory.harness).toBeDefined();
    expect(memory.harness.agentId).toBe("langchain");

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

  it("newSession creates a fresh harness and chatHistory", async () => {
    const memory = await createDb0({ dbPath: ":memory:" });

    const firstSessionId = memory.harness.sessionId;
    const { harness, chatHistory } = memory.newSession("session-2");

    expect(harness.sessionId).toBe("session-2");
    expect(harness.sessionId).not.toBe(firstSessionId);
    expect(chatHistory).toBeDefined();

    memory.close();
  });
});
