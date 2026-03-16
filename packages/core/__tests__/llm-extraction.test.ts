import { describe, it, expect } from "vitest";
import { LlmExtractionStrategy } from "../src/extraction/llm.js";
import { createExtractionStrategy } from "../src/extraction/index.js";

describe("LlmExtractionStrategy", () => {
  it("calls the user-provided extractFn", async () => {
    const strategy = new LlmExtractionStrategy(async (text) => [
      { content: `extracted: ${text}`, scope: "user", tags: [] },
    ]);

    const input = "The user prefers dark mode for all editors.";
    const results = await strategy.extract(input);
    expect(results).toEqual([
      { content: `extracted: ${input}`, scope: "user", tags: [], sourceType: "inference", extractionMethod: "llm" },
    ]);
  });

  it("has a DEFAULT_PROMPT constant", () => {
    expect(LlmExtractionStrategy.DEFAULT_PROMPT).toContain("fact extraction");
  });
});

describe("LlmExtractionStrategy preserves caller-provided provenance", () => {
  it("does not overwrite sourceType and extractionMethod when provided by extractFn", async () => {
    const strategy = new LlmExtractionStrategy(async (_text) => [
      { content: "file-based fact", scope: "agent", tags: [], sourceType: "file", extractionMethod: "manual" },
    ]);

    const results = await strategy.extract("The user uploaded a configuration file with database settings.");
    expect(results).toHaveLength(1);
    expect(results[0].sourceType).toBe("file");
    expect(results[0].extractionMethod).toBe("manual");
  });
});

describe("createExtractionStrategy with llm type", () => {
  it("creates an LlmExtractionStrategy", () => {
    const strategy = createExtractionStrategy("llm", {
      extractFn: async () => [],
    });
    expect(strategy).toBeInstanceOf(LlmExtractionStrategy);
  });

  it("throws if llm type used without config", () => {
    expect(() => createExtractionStrategy("llm")).toThrow();
  });
});
