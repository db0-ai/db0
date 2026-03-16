import { describe, it, expect, beforeEach } from "vitest";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { db0, defaultEmbeddingFn } from "../src/index.js";

describe("L0 summary integration", () => {
  let harness: ReturnType<typeof db0.harness>;

  beforeEach(async () => {
    const backend = await createSqliteBackend();
    harness = db0.harness({
      agentId: "test-agent",
      sessionId: "test-session",
      userId: "test-user",
      backend,
    });
  });

  it("auto-generates summary from first sentence", async () => {
    const embedding = await defaultEmbeddingFn("test");
    const entry = await harness.memory().write({
      content: "User prefers dark mode. They also use TypeScript exclusively.",
      scope: "user",
      embedding,
    });

    expect(entry.summary).toBe("User prefers dark mode.");
  });

  it("preserves explicit summary", async () => {
    const embedding = await defaultEmbeddingFn("test");
    const entry = await harness.memory().write({
      content: "A very long detailed memory about preferences and workflows...",
      scope: "user",
      embedding,
      summary: "Custom L0 summary",
    });

    expect(entry.summary).toBe("Custom L0 summary");
  });

  it("returns summary in search results", async () => {
    const embedding = await defaultEmbeddingFn("dark mode preference");
    await harness.memory().write({
      content: "User prefers dark mode. They find it easier on the eyes.",
      scope: "user",
      embedding,
    });

    const results = await harness.memory().search({
      embedding,
      scope: "user",
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("User prefers dark mode.");
  });

  it("returns summary in list results", async () => {
    const embedding = await defaultEmbeddingFn("test");
    await harness.memory().write({
      content: "Always run tests before committing. This is non-negotiable.",
      scope: "user",
      embedding,
    });

    const list = await harness.memory().list("user");
    expect(list).toHaveLength(1);
    expect(list[0].summary).toBe("Always run tests before committing.");
  });

  it("returns summary in get result", async () => {
    const embedding = await defaultEmbeddingFn("test");
    const entry = await harness.memory().write({
      content: "Deploy on Fridays! Just kidding, never do that.",
      scope: "user",
      embedding,
    });

    const fetched = await harness.memory().get(entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.summary).toBe("Deploy on Fridays!");
  });

  it("uses custom summarizeFn when provided", async () => {
    const backend = await createSqliteBackend();
    const customHarness = db0.harness({
      agentId: "test",
      sessionId: "test",
      backend,
      summarizeFn: async (content) => `CUSTOM: ${typeof content === "string" ? content.slice(0, 10) : "obj"}`,
    });

    const embedding = await defaultEmbeddingFn("test");
    const entry = await customHarness.memory().write({
      content: "A very long piece of content that should be summarized by the custom function.",
      scope: "user",
      embedding,
    });

    expect(entry.summary).toBe("CUSTOM: A very lon");
  });
});
