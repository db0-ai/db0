import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LocalContentStore } from "../src/content-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("LocalContentStore", () => {
  let dir: string;
  let store: LocalContentStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-test-"));
    store = new LocalContentStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("write and read a file", async () => {
    await store.write("user/prefs.md", "hello world");
    const content = await store.read("user/prefs.md");
    expect(content).toBe("hello world");
  });

  it("list files recursively", async () => {
    await store.write("user/a.md", "a");
    await store.write("user/b.md", "b");
    await store.write("agent/c.md", "c");
    const all = await store.list();
    expect(all.sort()).toEqual(["agent/c.md", "user/a.md", "user/b.md"]);
  });

  it("list files with prefix", async () => {
    await store.write("user/a.md", "a");
    await store.write("agent/b.md", "b");
    const userFiles = await store.list("user");
    expect(userFiles).toEqual(["user/a.md"]);
  });

  it("check existence", async () => {
    expect(await store.exists("user/x.md")).toBe(false);
    await store.write("user/x.md", "x");
    expect(await store.exists("user/x.md")).toBe(true);
  });

  it("delete a file", async () => {
    await store.write("user/x.md", "x");
    await store.delete("user/x.md");
    expect(await store.exists("user/x.md")).toBe(false);
  });

  it("ignores non-md files and dotfiles", async () => {
    await store.write("user/a.md", "a");
    await store.write("user/b.txt", "b");
    await store.write(".db0/index.json", "{}");
    const files = await store.list();
    expect(files).toEqual(["user/a.md"]);
  });
});
