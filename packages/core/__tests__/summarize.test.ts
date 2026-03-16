import { describe, it, expect } from "vitest";
import { defaultSummarize } from "../src/util/summarize.js";

describe("defaultSummarize", () => {
  it("extracts the first sentence", () => {
    const text = "User prefers dark mode. They also like TypeScript. And bun.";
    expect(defaultSummarize(text)).toBe("User prefers dark mode.");
  });

  it("handles question marks", () => {
    expect(defaultSummarize("Should we use Postgres? I think so.")).toBe(
      "Should we use Postgres?",
    );
  });

  it("handles exclamation marks", () => {
    expect(defaultSummarize("Always use strict mode! It catches bugs.")).toBe(
      "Always use strict mode!",
    );
  });

  it("truncates long single-sentence content to 120 chars", () => {
    const long = "A".repeat(200);
    const result = defaultSummarize(long);
    expect(result.length).toBe(120);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns short content as-is when no sentence boundary", () => {
    expect(defaultSummarize("Short note")).toBe("Short note");
  });

  it("handles JSON object content", () => {
    const obj = { key: "value", nested: { a: 1 } };
    const result = defaultSummarize(obj);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("skips very short first sentence and falls back", () => {
    // "Hi." is < 10 chars, so should fall back to truncation
    expect(defaultSummarize("Hi. This is the real content.")).toBe(
      "Hi. This is the real content.",
    );
  });
});
