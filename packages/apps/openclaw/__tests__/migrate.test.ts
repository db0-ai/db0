import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import {
  parseLegacyMarkdown,
  discoverLegacyMemories,
  migrateFromOpenClaw,
} from "../src/migrate.js";

describe("parseLegacyMarkdown", () => {
  it("parses bullet points as entries", () => {
    const md = `# My Memories
- User prefers dark mode
- Project uses TypeScript
`;
    const entries = parseLegacyMarkdown(md, "MEMORY.md");
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("User prefers dark mode");
    expect(entries[1].content).toBe("Project uses TypeScript");
  });

  it("tracks sections", () => {
    const md = `## Preferences
- Likes dark mode

## Technical
- Uses bun not npm
`;
    const entries = parseLegacyMarkdown(md, "MEMORY.md");
    expect(entries[0].section).toBe("Preferences");
    expect(entries[1].section).toBe("Technical");
    expect(entries[0].tags).toContain("section:Preferences");
  });

  it("skips short lines and bare links", () => {
    const md = `- ok
- This is a real memory
[link](http://example.com)
`;
    const entries = parseLegacyMarkdown(md, "test.md");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("This is a real memory");
  });

  it("handles plain text lines (no bullets)", () => {
    const md = `User always runs tests before committing`;
    const entries = parseLegacyMarkdown(md, "MEMORY.md");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("User always runs tests before committing");
  });

  it("attaches date tag for daily log entries", () => {
    const md = `- Debugged the auth flow today\n- Decided to use JWT`;
    const entries = parseLegacyMarkdown(md, "memory/2025-03-10.md", "2025-03-10");
    expect(entries).toHaveLength(2);
    expect(entries[0].date).toBe("2025-03-10");
    expect(entries[0].tags).toContain("date:2025-03-10");
    expect(entries[1].tags).toContain("source:memory/2025-03-10.md");
  });
});

describe("discoverLegacyMemories", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db0-migrate-"));
  });

  it("reads MEMORY.md and daily logs from memory/", () => {
    writeFileSync(join(dir, "MEMORY.md"), "- User prefers TypeScript\n");
    mkdirSync(join(dir, "memory"));
    writeFileSync(
      join(dir, "memory", "2025-03-09.md"),
      "- Set up the project scaffolding\n",
    );
    writeFileSync(
      join(dir, "memory", "2025-03-10.md"),
      "- Fixed auth bug\n- Added rate limiting\n",
    );

    const entries = discoverLegacyMemories(dir);
    expect(entries).toHaveLength(4);

    // MEMORY.md first
    expect(entries[0].source).toBe("MEMORY.md");
    expect(entries[0].date).toBeUndefined();

    // Daily logs sorted by date
    expect(entries[1].source).toBe("memory/2025-03-09.md");
    expect(entries[1].date).toBe("2025-03-09");
    expect(entries[2].source).toBe("memory/2025-03-10.md");
    expect(entries[2].date).toBe("2025-03-10");
  });

  it("handles non-date filenames in memory/ gracefully", () => {
    mkdirSync(join(dir, "memory"));
    writeFileSync(join(dir, "memory", "notes.md"), "- Some random note\n");

    const entries = discoverLegacyMemories(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBeUndefined();
    expect(entries[0].source).toBe("memory/notes.md");
  });

  it("returns empty for non-existent directory", () => {
    const entries = discoverLegacyMemories(join(dir, "nope"));
    expect(entries).toHaveLength(0);
  });
});

describe("migrateFromOpenClaw", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db0-migrate-"));
  });

  it("imports MEMORY.md as user-scoped, daily logs as session-scoped", async () => {
    writeFileSync(join(dir, "MEMORY.md"), "- User prefers dark mode\n");
    mkdirSync(join(dir, "memory"));
    writeFileSync(join(dir, "memory", "2025-03-10.md"), "- Fixed the auth flow\n");

    const backend = await createSqliteBackend();
    const result = await migrateFromOpenClaw({
      memoryDir: dir,
      backend,
      agentId: "test-agent",
    });

    expect(result.imported).toBe(2);
    expect(result.sources).toContain("MEMORY.md");
    expect(result.sources).toContain("memory/2025-03-10.md");

    const memories = await backend.memoryList("test-agent");
    expect(memories).toHaveLength(2);

    const curated = memories.find((m) => m.content === "User prefers dark mode");
    const daily = memories.find((m) => m.content === "Fixed the auth flow");

    expect(curated).toBeDefined();
    expect(curated!.scope).toBe("user");
    expect(curated!.tags).toContain("legacy-import");

    expect(daily).toBeDefined();
    expect(daily!.scope).toBe("session");
    expect(daily!.tags).toContain("date:2025-03-10");
  });

  it("respects explicit scope override", async () => {
    writeFileSync(join(dir, "MEMORY.md"), "- A curated fact\n");
    mkdirSync(join(dir, "memory"));
    writeFileSync(join(dir, "memory", "2025-03-10.md"), "- A daily note\n");

    const backend = await createSqliteBackend();
    await migrateFromOpenClaw({
      memoryDir: dir,
      backend,
      agentId: "test-agent",
      scope: "agent",
    });

    const memories = await backend.memoryList("test-agent");
    expect(memories.every((m) => m.scope === "agent")).toBe(true);
  });

  it("respects filter option", async () => {
    writeFileSync(
      join(dir, "MEMORY.md"),
      "- Keep this\n- Skip this one\n- Keep this too\n",
    );

    const backend = await createSqliteBackend();
    const result = await migrateFromOpenClaw({
      memoryDir: dir,
      backend,
      agentId: "test-agent",
      filter: (entry) => !entry.content.includes("Skip"),
    });

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it("calls onProgress callback", async () => {
    writeFileSync(join(dir, "MEMORY.md"), "- Fact one\n- Fact two\n");

    const backend = await createSqliteBackend();
    const progress: number[] = [];

    await migrateFromOpenClaw({
      memoryDir: dir,
      backend,
      agentId: "test-agent",
      onProgress: (_entry, index, _total) => progress.push(index),
    });

    expect(progress).toEqual([0, 1]);
  });
});
