import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryStore.search", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-test-"));
    store = new MemoryStore({ dir });
    await store.remember("User prefers Rust for CLI tools", { scope: "user" });
    await store.remember("Deploy target is AWS us-east-1", { scope: "agent" });
    await store.remember("Use vitest for all tests", { scope: "agent" });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ranked results", async () => {
    const results = await store.search("Rust programming language");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("Rust");
  });

  it("respects limit", async () => {
    const results = await store.search("tools", { limit: 1 });
    expect(results.length).toBe(1);
  });

  it("filters by scope", async () => {
    const results = await store.search("tools", { scope: ["agent"] });
    for (const r of results) {
      expect(r.scope).toBe("agent");
    }
  });

  it("includes age information", async () => {
    const results = await store.search("Rust");
    expect(results[0].age).toBe("today");
  });
});
