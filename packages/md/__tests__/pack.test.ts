import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryStore.pack", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-pack-test-"));
    store = new MemoryStore({ dir });
    await store.remember("User prefers TypeScript for all projects", {
      scope: "user",
    });
    await store.remember("Deploy target is AWS us-east-1", { scope: "agent" });
    await store.remember("Use vitest for all unit tests", { scope: "agent" });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("assembles all memories when no query is given", async () => {
    const output = await store.pack();
    expect(output).toContain("TypeScript");
    expect(output).toContain("AWS");
    expect(output).toContain("vitest");
  });

  it("truncates output when tokenBudget is very small", async () => {
    // A budget of 20 tokens = 80 chars, which can hold at most one short block
    const output = await store.pack({ tokenBudget: 20 });
    // At least one fact should be there since budget cuts after first exceed
    // but definitely not all three
    const factCount = [
      output.includes("TypeScript"),
      output.includes("AWS"),
      output.includes("vitest"),
    ].filter(Boolean).length;
    expect(factCount).toBeLessThan(3);
  });

  it("returns relevant results first when a query is given", async () => {
    const output = await store.pack({ query: "programming language TypeScript" });
    // The TypeScript fact should appear in the output
    expect(output).toContain("TypeScript");
    // The output should have the TypeScript fact before others (it appears at top)
    const tsIndex = output.indexOf("TypeScript");
    const awsIndex = output.indexOf("AWS");
    // TypeScript should come before AWS since it is more relevant to the query
    if (awsIndex !== -1) {
      expect(tsIndex).toBeLessThan(awsIndex);
    }
  });

  it("returns empty string when no memories exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "db0-md-empty-test-"));
    try {
      const emptyStore = new MemoryStore({ dir: emptyDir });
      const output = await emptyStore.pack();
      expect(output).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
