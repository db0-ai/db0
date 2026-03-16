import { describe, it, expect } from "vitest";
import { rrfMerge, ftsScore } from "../src/util/rrf.js";

describe("rrfMerge", () => {
  it("merges two ranked lists", () => {
    const listA = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const listB = [{ id: "b" }, { id: "c" }, { id: "d" }];

    const scores = rrfMerge([listA, listB], (item) => item.id);

    // "b" appears in both lists, should have highest score
    const entries = [...scores.entries()];
    expect(entries[0][0]).toBe("b");
    expect(scores.get("b")!).toBeGreaterThan(scores.get("a")!);
  });

  it("handles empty lists", () => {
    const scores = rrfMerge([], (item: { id: string }) => item.id);
    expect(scores.size).toBe(0);
  });
});

describe("ftsScore", () => {
  it("scores based on matching terms", () => {
    const score = ftsScore("The quick brown fox", "brown fox");
    expect(score).toBe(1); // both terms match
  });

  it("returns 0 for no matches", () => {
    const score = ftsScore("The quick brown fox", "purple elephant");
    expect(score).toBe(0);
  });

  it("returns partial score for partial matches", () => {
    const score = ftsScore("The quick brown fox", "brown elephant");
    expect(score).toBe(0.5); // 1 of 2 terms
  });

  it("is case insensitive", () => {
    const score = ftsScore("TypeScript Language", "typescript");
    expect(score).toBe(1);
  });
});
