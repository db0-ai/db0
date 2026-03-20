import { describe, it, expect } from "vitest";
import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { Db0ChatMessageHistory } from "../src/chat-history.js";

async function setup(extractFacts = true) {
  const backend = await createSqliteBackend({ dbPath: ":memory:" });
  const harness = db0.harness({
    agentId: "test",
    sessionId: "s1",
    userId: "u1",
    backend,
    embeddingFn: defaultEmbeddingFn,
    profile: PROFILE_CONVERSATIONAL,
  });
  const history = new Db0ChatMessageHistory({ harness, extractFacts });
  return { harness, history };
}

describe("Db0ChatMessageHistory", () => {
  it("stores and retrieves messages", async () => {
    const { harness, history } = await setup();

    await history.addUserMessage("Hello");
    await history.addAIMessage("Hi there!");

    const messages = await history.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(messages[1]).toBeInstanceOf(AIMessage);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].content).toBe("Hi there!");

    harness.close();
  });

  it("clears messages", async () => {
    const { harness, history } = await setup();

    await history.addUserMessage("Hello");
    await history.clear();

    const messages = await history.getMessages();
    expect(messages).toHaveLength(0);

    harness.close();
  });

  it("extracts facts from messages when enabled", async () => {
    const { harness, history } = await setup(true);

    // "always use" is a signal word
    await history.addUserMessage("I always use TypeScript with strict mode");

    const memories = await harness.memory().list();
    expect(memories.length).toBeGreaterThan(0);
    const contents = memories.map((m) => String(m.content));
    expect(contents.some((c) => c.toLowerCase().includes("typescript"))).toBe(true);

    harness.close();
  });

  it("does not extract facts when disabled", async () => {
    const { harness, history } = await setup(false);

    await history.addUserMessage("I always use TypeScript with strict mode");

    const memories = await harness.memory().list();
    expect(memories).toHaveLength(0);

    harness.close();
  });

  it("logs messages to structured log", async () => {
    const { harness, history } = await setup();

    await history.addUserMessage("Hello");
    await history.addAIMessage("Hi!");

    const logs = await harness.log().query();
    expect(logs.length).toBe(2);
    const events = logs.map((l) => l.event).sort();
    expect(events).toContain("user.message");
    expect(events).toContain("assistant.message");

    harness.close();
  });
});
