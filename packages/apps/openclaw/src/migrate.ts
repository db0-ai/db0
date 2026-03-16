import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  defaultEmbeddingFn,
  type Db0Backend,
  type MemoryScope,
} from "@db0-ai/core";

/**
 * A single parsed entry from a legacy OpenClaw memory file.
 */
export interface LegacyMemoryEntry {
  content: string;
  /** Source file relative path, e.g. "MEMORY.md" or "memory/2025-03-10.md" */
  source: string;
  /** Section header within the file, if any. */
  section?: string;
  /** Date extracted from daily log filename (YYYY-MM-DD), if applicable. */
  date?: string;
  tags: string[];
}

/**
 * Options for the legacy migration.
 */
export interface MigrateOptions {
  /**
   * Path to the OpenClaw workspace directory.
   *
   * OpenClaw stores memory as plain Markdown in the agent workspace:
   * - `MEMORY.md` — curated long-term memory (durable facts, preferences, decisions)
   * - `memory/YYYY-MM-DD.md` — daily append-only logs
   *
   * Default workspace: `~/.openclaw/workspace`
   */
  memoryDir: string;
  /** The db0 backend to migrate into. */
  backend: Db0Backend;
  /** Agent ID to assign migrated memories. Default: "openclaw" */
  agentId?: string;
  /** Session ID for the migration batch. Default: "migration-<timestamp>" */
  sessionId?: string;
  /** User ID to assign. */
  userId?: string;
  /**
   * Scope for migrated memories.
   * Default: "user" for MEMORY.md entries, "session" for daily logs.
   */
  scope?: MemoryScope;
  /** Embedding function. Falls back to built-in hash embeddings. */
  embeddingFn?: (text: string) => Promise<Float32Array>;
  /** Called for each entry before writing. Return false to skip. */
  filter?: (entry: LegacyMemoryEntry) => boolean;
  /** Called after each entry is written. */
  onProgress?: (entry: LegacyMemoryEntry, index: number, total: number) => void;
}

export interface MigrateResult {
  imported: number;
  skipped: number;
  sources: string[];
}

const DATE_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/**
 * Parse a legacy OpenClaw Markdown memory file into entries.
 *
 * OpenClaw memory files are plain Markdown. This parser handles:
 * - `## Section` headers (tracked as metadata)
 * - Bullet lines (`- ` or `* ` prefix, stripped)
 * - Plain text lines
 * - Skips empty lines, bare links, and very short lines (<5 chars)
 *
 * @param content - Raw Markdown content
 * @param source - Relative file path (e.g. "MEMORY.md", "memory/2025-03-10.md")
 * @param date - Optional date string for daily log files
 */
export function parseLegacyMarkdown(
  content: string,
  source: string,
  date?: string,
): LegacyMemoryEntry[] {
  const entries: LegacyMemoryEntry[] = [];
  let currentSection: string | undefined;

  for (const raw of content.split("\n")) {
    const line = raw.trim();

    if (!line) continue;

    // Section headers
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("# ")) {
      currentSection = line.slice(2).trim();
      continue;
    }

    // Skip markdown links that are just references (e.g., "[link](url)")
    if (/^\[.*\]\(.*\)$/.test(line)) continue;

    // Strip bullet prefix
    let text = line;
    if (text.startsWith("- ")) text = text.slice(2);
    if (text.startsWith("* ")) text = text.slice(2);

    // Skip very short lines (likely noise)
    if (text.length < 5) continue;

    const tags = ["legacy-import", `source:${source}`];
    if (currentSection) tags.push(`section:${currentSection}`);
    if (date) tags.push(`date:${date}`);

    entries.push({
      content: text,
      source,
      section: currentSection,
      date,
      tags,
    });
  }

  return entries;
}

/**
 * Discover and parse all legacy OpenClaw memory files from a workspace.
 *
 * OpenClaw memory layout:
 * - `MEMORY.md` — curated long-term memory (decisions, preferences, durable facts)
 * - `memory/YYYY-MM-DD.md` — daily append-only logs (running context, notes)
 *
 * Both are plain Markdown. MEMORY.md is loaded at session start;
 * daily logs load today + yesterday.
 */
export function discoverLegacyMemories(memoryDir: string): LegacyMemoryEntry[] {
  const entries: LegacyMemoryEntry[] = [];

  // Curated long-term memory
  const mainFile = join(memoryDir, "MEMORY.md");
  if (existsSync(mainFile)) {
    const content = readFileSync(mainFile, "utf-8");
    entries.push(...parseLegacyMarkdown(content, "MEMORY.md"));
  }

  // Daily logs: memory/YYYY-MM-DD.md
  const memSubdir = join(memoryDir, "memory");
  if (existsSync(memSubdir)) {
    const files = readdirSync(memSubdir)
      .filter((f) => f.endsWith(".md"))
      .sort();

    for (const file of files) {
      const content = readFileSync(join(memSubdir, file), "utf-8");
      const source = `memory/${file}`;

      // Extract date from daily log filenames
      const dateMatch = file.match(DATE_FILENAME_RE);
      const date = dateMatch ? dateMatch[1] : undefined;

      entries.push(...parseLegacyMarkdown(content, source, date));
    }
  }

  return entries;
}

/**
 * Migrate legacy OpenClaw Markdown memories into a db0 backend.
 *
 * OpenClaw stores memory as plain Markdown in the agent workspace:
 * - `MEMORY.md` → migrated as **user**-scoped memories (durable facts)
 * - `memory/YYYY-MM-DD.md` → migrated as **session**-scoped memories (daily context)
 *
 * The Markdown files are the source of truth in OpenClaw. The SQLite file
 * at `~/.openclaw/memory/<agentId>.sqlite` is just a search index and does
 * not need to be migrated — db0 rebuilds its own embeddings.
 *
 * @example
 * ```ts
 * import { migrateFromOpenClaw } from "@db0-ai/openclaw";
 * import { createSqliteBackend } from "@db0-ai/backends-sqlite";
 *
 * const backend = await createSqliteBackend({ dbPath: "./memory.sqlite" });
 * const result = await migrateFromOpenClaw({
 *   memoryDir: "~/.openclaw/workspace",
 *   backend,
 *   agentId: "my-agent",
 * });
 * console.log(`Imported ${result.imported} memories from ${result.sources.join(", ")}`);
 * ```
 */
export async function migrateFromOpenClaw(
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const embeddingFn = opts.embeddingFn ?? defaultEmbeddingFn;
  const agentId = opts.agentId ?? "openclaw";
  const sessionId = opts.sessionId ?? `migration-${Date.now()}`;
  const userId = opts.userId ?? undefined;

  const entries = discoverLegacyMemories(opts.memoryDir);

  let imported = 0;
  let skipped = 0;
  const sources = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (opts.filter && !opts.filter(entry)) {
      skipped++;
      continue;
    }

    // MEMORY.md entries are durable facts → "user" scope
    // Daily logs are running context → "session" scope
    // Explicit scope override takes precedence
    const scope = opts.scope ?? (entry.date ? "session" : "user");

    const embedding = await embeddingFn(entry.content);

    await opts.backend.memoryWrite(agentId, sessionId, userId ?? null, {
      content: entry.content,
      scope,
      embedding,
      tags: entry.tags,
      metadata: {
        legacySource: entry.source,
        legacySection: entry.section,
        legacyDate: entry.date,
        migratedAt: new Date().toISOString(),
      },
    });

    sources.add(entry.source);
    imported++;

    opts.onProgress?.(entry, i, entries.length);
  }

  return {
    imported,
    skipped,
    sources: [...sources],
  };
}
