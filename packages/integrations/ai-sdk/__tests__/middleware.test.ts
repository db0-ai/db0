import { describe, it, expect } from "vitest";
import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { db0MemoryMiddleware } from "../src/middleware.js";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";

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
  return { backend, harness };
}

function makeParams(userText: string, system?: string): LanguageModelV3CallOptions {
  const prompt: LanguageModelV3CallOptions["prompt"] = [];
  if (system) {
    prompt.push({ role: "system", content: system });
  }
  prompt.push({
    role: "user",
    content: [{ type: "text", text: userText }],
  });
  return { prompt } as LanguageModelV3CallOptions;
}

describe("db0MemoryMiddleware", () => {
  it("returns params unchanged when no memories exist", async () => {
    const { harness } = await setup();
    const middleware = db0MemoryMiddleware({ harness });

    const params = makeParams("Hello");
    const result = await middleware.transformParams!({
      type: "generate",
      params,
      model: {} as any,
    });

    // No memories → params should be unchanged
    expect(result.prompt).toEqual(params.prompt);
    harness.close();
  });

  it("injects memories into system prompt when relevant memories exist", async () => {
    const { harness } = await setup();
    const middleware = db0MemoryMiddleware({ harness, extractOnResponse: false });

    // Write a memory
    await harness.context().ingest("User prefers dark mode", { scope: "user" });

    const params = makeParams("What are my preferences?", "You are a helpful assistant.");
    const result = await middleware.transformParams!({
      type: "generate",
      params,
      model: {} as any,
    });

    // System prompt should now contain the memory
    const systemMsg = result.prompt.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect((systemMsg as any).content).toContain("dark mode");

    harness.close();
  });

  it("adds system message when none exists", async () => {
    const { harness } = await setup();
    const middleware = db0MemoryMiddleware({ harness, extractOnResponse: false });

    // Use the exact same text for memory and query so hash embeddings match
    await harness.context().ingest("User likes TypeScript", { scope: "user" });

    const params = makeParams("User likes TypeScript");
    const result = await middleware.transformParams!({
      type: "generate",
      params,
      model: {} as any,
    });

    const systemMsg = result.prompt.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect((systemMsg as any).content).toContain("TypeScript");

    harness.close();
  });

  it("extracts facts from user messages when extractOnResponse is true", async () => {
    const { harness } = await setup();
    const middleware = db0MemoryMiddleware({ harness, extractOnResponse: true });

    // "always use" is a signal word that triggers rules extraction
    const params = makeParams("I always use bun as my package manager");
    await middleware.transformParams!({
      type: "generate",
      params,
      model: {} as any,
    });

    // Facts land in memory via context().ingest(), check all scopes
    const memories = await harness.memory().list();
    expect(memories.length).toBeGreaterThan(0);
    const contents = memories.map((m) => String(m.content));
    expect(contents.some((c) => c.toLowerCase().includes("bun"))).toBe(true);

    harness.close();
  });

  it("extracts facts from assistant responses via wrapGenerate", async () => {
    const { harness } = await setup();
    const middleware = db0MemoryMiddleware({ harness, extractOnResponse: true });

    const mockResult = {
      content: [
        { type: "text", text: "I'll remember that you prefer dark mode for all your projects." },
      ],
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };

    await middleware.wrapGenerate!({
      doGenerate: async () => mockResult as any,
      doStream: async () => ({} as any),
      params: makeParams("test"),
      model: {} as any,
    });

    const memories = await harness.memory().list("user");
    const contents = memories.map((m) => String(m.content));
    expect(contents.some((c) => c.toLowerCase().includes("dark mode"))).toBe(true);

    harness.close();
  });

  it("respects extractOnResponse: false", async () => {
    const { harness } = await setup();
    const middleware = db0MemoryMiddleware({ harness, extractOnResponse: false });

    const params = makeParams("I always use vim as my editor");
    await middleware.transformParams!({
      type: "generate",
      params,
      model: {} as any,
    });

    const memories = await harness.memory().list();
    expect(memories.length).toBe(0);

    harness.close();
  });
});
