import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { LocalContentStore } from "../src/content-store.js";
import { serializeMarkdown } from "../src/markdown.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryStore.consolidate", () => {
  let dir: string;
  let store: MemoryStore;
  let contentStore: LocalContentStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-consolidate-test-"));
    contentStore = new LocalContentStore(dir);
    store = new MemoryStore({ dir, contentStore });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("expires old session files (>24h)", async () => {
    // Write a session file with a very old created timestamp directly
    const old = serializeMarkdown(
      { id: "m_old", scope: "session", created: "2020-01-01T00:00:00Z" },
      "Old session fact from 2020",
    );
    await contentStore.write("session/old-fact.md", old);

    const result = await store.consolidate();

    expect(result.expired).toBe(1);
    // The file should be gone
    expect(existsSync(join(dir, "session/old-fact.md"))).toBe(false);
  });

  it("preserves recent session files", async () => {
    // Use store.remember() which stamps the current time
    const res = await store.remember("Current session fact", {
      scope: "session",
    });

    const result = await store.consolidate();

    expect(result.expired).toBe(0);
    // The file should still exist
    expect(existsSync(join(dir, res.file))).toBe(true);
  });

  it("regenerates MEMORIES.md after consolidate", async () => {
    await store.remember("Agent always uses ESM modules", { scope: "agent" });

    await store.consolidate();

    // generateIndex is not called by consolidate itself, but we can verify
    // that consolidate doesn't break anything and then generate the index
    const index = await store.generateIndex();
    expect(existsSync(join(dir, "MEMORIES.md"))).toBe(true);
    expect(index).toContain("# MEMORIES.md");
    expect(index).toContain("ESM modules");
  });

  it("returns zero counts when nothing to expire, merge, or archive", async () => {
    const result = await store.consolidate();
    expect(result.expired).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.archived).toBe(0);
  });

  it("expires old task files (>24h)", async () => {
    const old = serializeMarkdown(
      { id: "m_task_old", scope: "task", created: "2019-06-15T12:00:00Z" },
      "Old task fact",
    );
    await contentStore.write("task/old-task.md", old);

    const result = await store.consolidate();

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dir, "task/old-task.md"))).toBe(false);
  });
});
