import { describe, it, expect } from "vitest";
import { chunkText } from "../src/ingest/chunker.js";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("Hello world");
    expect(chunks).toEqual(["Hello world"]);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "a ".repeat(600).trim(); // ~1200 chars
    const chunks = chunkText(text, { chunkSize: 500, chunkOverlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    // Chunks should overlap
    const lastOfFirst = chunks[0].slice(-50);
    expect(chunks[1]).toContain(lastOfFirst.trim().split(" ").pop());
  });

  it("respects custom chunkSize", () => {
    const text = "word ".repeat(200);
    const chunks = chunkText(text, { chunkSize: 100, chunkOverlap: 0 });
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(110); // allow small overshoot at word boundary
    }
  });

  it("handles empty text", () => {
    const chunks = chunkText("");
    expect(chunks).toEqual([]);
  });
});
