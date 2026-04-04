import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryStore.remember", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-test-"));
    store = new MemoryStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a new memory file", async () => {
    const result = await store.remember("User prefers Rust", { scope: "user" });
    expect(result.action).toBe("created");
    expect(result.file).toMatch(/^user\/.+\.md$/);
    const raw = readFileSync(join(dir, result.file), "utf8");
    expect(raw).toContain("User prefers Rust");
    expect(raw).toContain("scope: user");
  });

  it("supersedes a highly similar memory", async () => {
    await store.remember("User prefers Python", { scope: "user" });
    const result = await store.remember("User prefers Rust", { scope: "user" });
    expect(result.action).toBe("superseded");
    expect(result.superseded).toBeDefined();
    expect(result.superseded!.content).toContain("Python");
    const raw = readFileSync(join(dir, result.file), "utf8");
    expect(raw).toContain("Rust");
    expect(raw).not.toContain("Python");
  });

  it("creates independently for unrelated facts", async () => {
    const r1 = await store.remember("User prefers Rust", { scope: "user" });
    const r2 = await store.remember("Deploy target is AWS", { scope: "agent" });
    expect(r1.file).not.toBe(r2.file);
    expect(r2.action).toBe("created");
  });

  it("adds tags to frontmatter", async () => {
    const result = await store.remember("Use vitest for testing", {
      scope: "agent",
      tags: ["testing", "tooling"],
    });
    const raw = readFileSync(join(dir, result.file), "utf8");
    expect(raw).toContain("testing");
    expect(raw).toContain("tooling");
  });
});
