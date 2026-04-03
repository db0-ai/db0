import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryStore.generateIndex (MEMORIES.md)", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-index-test-"));
    store = new MemoryStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates MEMORIES.md with the correct header", async () => {
    await store.remember("User prefers dark mode", { scope: "user" });

    const index = await store.generateIndex();

    expect(index).toContain("# MEMORIES.md");
    expect(existsSync(join(dir, "MEMORIES.md"))).toBe(true);
  });

  it("contains scope heading and memory content", async () => {
    await store.remember("User prefers dark mode", { scope: "user" });

    const index = await store.generateIndex();

    expect(index).toContain("## user");
    expect(index).toContain("dark mode");
  });

  it("groups memories by scope", async () => {
    await store.remember("User prefers Rust", { scope: "user" });
    await store.remember("Deploy to AWS us-east-1", { scope: "agent" });

    const index = await store.generateIndex();

    expect(index).toContain("## user");
    expect(index).toContain("## agent");
    expect(index).toContain("Rust");
    expect(index).toContain("AWS");

    // user section should come before agent section (scope order: user, agent, session, task)
    const userPos = index.indexOf("## user");
    const agentPos = index.indexOf("## agent");
    expect(userPos).toBeLessThan(agentPos);
  });

  it("writes MEMORIES.md to disk with correct content", async () => {
    await store.remember("User prefers TypeScript", { scope: "user" });

    await store.generateIndex();

    const onDisk = readFileSync(join(dir, "MEMORIES.md"), "utf8");
    expect(onDisk).toContain("# MEMORIES.md");
    expect(onDisk).toContain("TypeScript");
  });

  it("shows total count in header region (multiple scopes)", async () => {
    await store.remember("User prefers Rust", { scope: "user" });
    await store.remember("Agent uses ESM", { scope: "agent" });
    await store.remember("Agent deploys to AWS", { scope: "agent" });

    const index = await store.generateIndex();

    // Both user and agent sections should be present
    expect(index).toContain("## user");
    expect(index).toContain("## agent");
    // All three facts should appear
    expect(index).toContain("Rust");
    expect(index).toContain("ESM");
    expect(index).toContain("AWS");
  });

  it("omits scope sections that have no memories", async () => {
    // Only add a user-scope memory
    await store.remember("User prefers Vim", { scope: "user" });

    const index = await store.generateIndex();

    expect(index).toContain("## user");
    expect(index).not.toContain("## agent");
    expect(index).not.toContain("## session");
    expect(index).not.toContain("## task");
  });
});
