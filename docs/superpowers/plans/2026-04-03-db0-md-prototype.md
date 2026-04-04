# db0/md Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool (`db0`) that turns a directory of markdown files into a managed memory system with smart write, search, context assembly, and garbage collection.

**Architecture:** `@db0-ai/md` package wraps `@db0-ai/core` utilities (hashEmbed, cosineSimilarity, memoryAge, generateId) without using the full harness/backend stack. v1 is pure files — no SQLite, brute-force scan with hash embeddings. A `ContentStore` interface abstracts file I/O for future S3 migration. The CLI binary exposes five commands: `remember`, `search`, `pack`, `consolidate`, `index`.

**Tech Stack:** TypeScript (ESM, NodeNext), `@db0-ai/core` (hash embeddings, cosine similarity, staleness), Node.js fs/path, vitest for tests.

---

## File Structure

```
packages/md/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                  # Public SDK exports
│   ├── cli.ts                    # CLI entry point (bin)
│   ├── content-store.ts          # ContentStore interface + LocalContentStore
│   ├── markdown.ts               # Parse/serialize markdown with YAML frontmatter
│   ├── memory-store.ts           # MemoryStore class — the core engine
│   ├── memories-index.ts         # MEMORIES.md generator
│   └── types.ts                  # Shared types (MemoryFile, RememberResult, etc.)
├── __tests__/
│   ├── markdown.test.ts          # Frontmatter parse/serialize
│   ├── content-store.test.ts     # LocalContentStore file operations
│   ├── remember.test.ts          # Smart write: dedup, supersede, create
│   ├── search.test.ts            # Brute-force search ranking
│   ├── pack.test.ts              # Context assembly with budget
│   ├── consolidate.test.ts       # Garbage collection
│   └── memories-index.test.ts    # MEMORIES.md generation
```

---

### Task 1: Package Scaffolding

**Files:**
- Create: `packages/md/package.json`
- Create: `packages/md/tsconfig.json`
- Create: `packages/md/src/index.ts`
- Create: `packages/md/src/types.ts`
- Modify: `package.json` (root — add workspace)

- [ ] **Step 1: Create package.json**

Create `packages/md/package.json`:

```json
{
  "name": "@db0-ai/md",
  "version": "0.3.0",
  "description": "The embedded memory primitive for AI agents. Markdown files + smart lifecycle.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "db0-md": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc"
  },
  "files": [
    "README.md",
    "dist"
  ],
  "license": "MIT",
  "dependencies": {
    "@db0-ai/core": "0.3.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/md/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create types.ts**

Create `packages/md/src/types.ts`:

```typescript
export type MemoryScope = "user" | "agent" | "session" | "task";

export interface MemoryFrontmatter {
  id: string;
  scope: MemoryScope;
  tags?: string[];
  created: string;
  supersedes?: string;
  "related-to"?: string[];
  expires?: string;
}

export interface MemoryFile {
  /** Relative path from memory dir, e.g. "user/language-prefs.md" */
  path: string;
  frontmatter: MemoryFrontmatter;
  content: string;
}

export interface RememberResult {
  action: "created" | "superseded" | "related";
  file: string;
  superseded?: { file: string; content: string };
  relatedTo?: string;
}

export interface SearchResult {
  file: string;
  content: string;
  scope: MemoryScope;
  score: number;
  age: string;
  stalenessCaveat: string | null;
}

export interface ConsolidateResult {
  merged: number;
  archived: number;
  expired: number;
}
```

- [ ] **Step 4: Create index.ts with placeholder exports**

Create `packages/md/src/index.ts`:

```typescript
export type {
  MemoryScope,
  MemoryFrontmatter,
  MemoryFile,
  RememberResult,
  SearchResult,
  ConsolidateResult,
} from "./types.js";
```

- [ ] **Step 5: Add workspace to root package.json**

In the root `package.json`, add `"packages/md"` to the `workspaces` array.

- [ ] **Step 6: Install and verify build**

Run: `npm install && npm run build -w packages/md`
Expected: Clean build with dist/ output, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/md/ package.json
git commit -m "feat(md): scaffold @db0-ai/md package with types"
```

---

### Task 2: ContentStore Interface + LocalContentStore

**Files:**
- Create: `packages/md/src/content-store.ts`
- Create: `packages/md/__tests__/content-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/md/__tests__/content-store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/md/__tests__/content-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement LocalContentStore**

Create `packages/md/src/content-store.ts`:

```typescript
import { readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { existsSync } from "node:fs";

export interface ContentStore {
  read(key: string): Promise<string>;
  write(key: string, content: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}

export class LocalContentStore implements ContentStore {
  constructor(private dir: string) {}

  async read(key: string): Promise<string> {
    return readFile(join(this.dir, key), "utf8");
  }

  async write(key: string, content: string): Promise<void> {
    const fullPath = join(this.dir, key);
    const parent = dirname(fullPath);
    if (!existsSync(parent)) {
      await mkdir(parent, { recursive: true });
    }
    await writeFile(fullPath, content, "utf8");
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.dir, key);
    if (existsSync(fullPath)) {
      await rm(fullPath);
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const scanDir = prefix ? join(this.dir, prefix) : this.dir;
    if (!existsSync(scanDir)) return [];
    return this.scanDir(scanDir);
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(join(this.dir, key));
  }

  private async scanDir(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.scanDir(fullPath)));
      } else if (entry.name.endsWith(".md") && entry.name !== "MEMORIES.md") {
        results.push(relative(this.dir, fullPath));
      }
    }
    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/md/__tests__/content-store.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/md/src/content-store.ts packages/md/__tests__/content-store.test.ts
git commit -m "feat(md): add ContentStore interface and LocalContentStore"
```

---

### Task 3: Markdown Parser/Serializer

**Files:**
- Create: `packages/md/src/markdown.ts`
- Create: `packages/md/__tests__/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/md/__tests__/markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src/markdown.js";

describe("parseMarkdown", () => {
  it("parses frontmatter and content", () => {
    const input = `---
id: m_abc123
scope: user
tags: [preference, language]
created: "2026-04-03T10:00:00Z"
---

User prefers Rust.`;

    const result = parseMarkdown(input);
    expect(result.frontmatter.id).toBe("m_abc123");
    expect(result.frontmatter.scope).toBe("user");
    expect(result.frontmatter.tags).toEqual(["preference", "language"]);
    expect(result.content).toBe("User prefers Rust.");
  });

  it("handles missing frontmatter", () => {
    const result = parseMarkdown("Just plain content.");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("Just plain content.");
  });

  it("handles partial frontmatter (scope only)", () => {
    const input = `---
scope: agent
---

A fact.`;
    const result = parseMarkdown(input);
    expect(result.frontmatter.scope).toBe("agent");
    expect(result.frontmatter.id).toBeUndefined();
    expect(result.content).toBe("A fact.");
  });
});

describe("serializeMarkdown", () => {
  it("serializes frontmatter and content", () => {
    const output = serializeMarkdown(
      {
        id: "m_abc123",
        scope: "user",
        tags: ["preference"],
        created: "2026-04-03T10:00:00Z",
      },
      "User prefers Rust.",
    );
    expect(output).toContain("id: m_abc123");
    expect(output).toContain("scope: user");
    expect(output).toContain("User prefers Rust.");
    expect(output.startsWith("---\n")).toBe(true);
  });

  it("roundtrips cleanly", () => {
    const fm = {
      id: "m_test",
      scope: "user" as const,
      tags: ["a", "b"],
      created: "2026-01-01T00:00:00Z",
    };
    const content = "Hello world.";
    const serialized = serializeMarkdown(fm, content);
    const parsed = parseMarkdown(serialized);
    expect(parsed.frontmatter.id).toBe("m_test");
    expect(parsed.frontmatter.scope).toBe("user");
    expect(parsed.frontmatter.tags).toEqual(["a", "b"]);
    expect(parsed.content).toBe(content);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/md/__tests__/markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement markdown parser/serializer**

Create `packages/md/src/markdown.ts`:

```typescript
import type { MemoryFrontmatter } from "./types.js";

/**
 * Minimal YAML frontmatter parser. No dependencies.
 * Handles the subset we need: scalars, arrays, quoted strings.
 */
export function parseMarkdown(raw: string): {
  frontmatter: Partial<MemoryFrontmatter>;
  content: string;
} {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, content: raw.trim() };
  }

  const fmBlock = fmMatch[1];
  const content = fmMatch[2].trim();
  const frontmatter: Record<string, unknown> = {};

  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Remove surrounding quotes
    if (
      typeof value === "string" &&
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = value.slice(1, -1);
    }

    // Parse inline arrays: [a, b, c]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (key) frontmatter[key] = value;
  }

  return { frontmatter: frontmatter as Partial<MemoryFrontmatter>, content };
}

/**
 * Serialize frontmatter + content into a markdown string.
 */
export function serializeMarkdown(
  frontmatter: Partial<MemoryFrontmatter>,
  content: string,
): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(content);

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/md/__tests__/markdown.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/md/src/markdown.ts packages/md/__tests__/markdown.test.ts
git commit -m "feat(md): add markdown frontmatter parser and serializer"
```

---

### Task 4: MemoryStore — Core Engine

**Files:**
- Create: `packages/md/src/memory-store.ts`
- Create: `packages/md/__tests__/remember.test.ts`
- Create: `packages/md/__tests__/search.test.ts`

- [ ] **Step 1: Write remember tests**

Create `packages/md/__tests__/remember.test.ts`:

```typescript
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

    // File should exist with correct content
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

    // The file should now contain Rust, not Python
    const raw = readFileSync(join(dir, result.file), "utf8");
    expect(raw).toContain("Rust");
    expect(raw).not.toContain("Python");
  });

  it("creates independently for unrelated facts", async () => {
    const r1 = await store.remember("User prefers Rust", { scope: "user" });
    const r2 = await store.remember("Deploy target is AWS", {
      scope: "agent",
    });
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
```

- [ ] **Step 2: Write search tests**

Create `packages/md/__tests__/search.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/md/__tests__/remember.test.ts packages/md/__tests__/search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement MemoryStore**

Create `packages/md/src/memory-store.ts`:

```typescript
import {
  hashEmbed,
  cosineSimilarity,
  generateId,
  memoryAge,
  defaultSummarize,
} from "@db0-ai/core";
import { LocalContentStore, type ContentStore } from "./content-store.js";
import { parseMarkdown, serializeMarkdown } from "./markdown.js";
import type {
  MemoryScope,
  MemoryFile,
  MemoryFrontmatter,
  RememberResult,
  SearchResult,
  ConsolidateResult,
} from "./types.js";

const HIGH_THRESHOLD = 0.9;
const MEDIUM_THRESHOLD = 0.7;

export interface MemoryStoreOpts {
  dir: string;
  contentStore?: ContentStore;
  highThreshold?: number;
  mediumThreshold?: number;
}

export interface RememberOpts {
  scope?: MemoryScope;
  tags?: string[];
}

export interface SearchOpts {
  limit?: number;
  scope?: MemoryScope[];
}

export interface PackOpts {
  query?: string;
  budget?: number;
}

export class MemoryStore {
  private store: ContentStore;
  private highThreshold: number;
  private mediumThreshold: number;
  private dir: string;

  constructor(opts: MemoryStoreOpts) {
    this.dir = opts.dir;
    this.store = opts.contentStore ?? new LocalContentStore(opts.dir);
    this.highThreshold = opts.highThreshold ?? HIGH_THRESHOLD;
    this.mediumThreshold = opts.mediumThreshold ?? MEDIUM_THRESHOLD;
  }

  /** Load all memory files from disk. */
  private async loadAll(): Promise<MemoryFile[]> {
    const keys = await this.store.list();
    const files: MemoryFile[] = [];
    for (const key of keys) {
      const raw = await this.store.read(key);
      const { frontmatter, content } = parseMarkdown(raw);
      files.push({
        path: key,
        frontmatter: frontmatter as MemoryFrontmatter,
        content,
      });
    }
    return files;
  }

  /** Compute embedding for text using core's hash embeddings. */
  private embed(text: string): Float32Array {
    return hashEmbed(text);
  }

  /** Generate a slug-friendly filename from content. */
  private slugify(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }

  /**
   * Smart write — the core differentiator.
   * Dedup, supersede, or create with relationship linking.
   */
  async remember(
    fact: string,
    opts: RememberOpts = {},
  ): Promise<RememberResult> {
    const scope = opts.scope ?? "user";
    const factEmbedding = this.embed(fact);
    const existing = await this.loadAll();

    // Find best match
    let bestMatch: { file: MemoryFile; score: number } | null = null;
    for (const file of existing) {
      const fileEmbedding = this.embed(file.content);
      const score = cosineSimilarity(factEmbedding, fileEmbedding);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { file, score };
      }
    }

    const id = `m_${generateId().slice(0, 8)}`;
    const now = new Date().toISOString();
    const frontmatter: MemoryFrontmatter = {
      id,
      scope,
      created: now,
      ...(opts.tags?.length ? { tags: opts.tags } : {}),
    };

    // High similarity → supersede
    if (bestMatch && bestMatch.score >= this.highThreshold) {
      const oldFile = bestMatch.file;
      frontmatter.supersedes = oldFile.frontmatter.id;
      const newContent = serializeMarkdown(frontmatter, fact);
      await this.store.write(oldFile.path, newContent);
      await this.generateIndex();
      return {
        action: "superseded",
        file: oldFile.path,
        superseded: { file: oldFile.path, content: oldFile.content },
      };
    }

    // Medium similarity → create with link
    const filePath = `${scope}/${this.slugify(fact)}.md`;
    if (
      bestMatch &&
      bestMatch.score >= this.mediumThreshold
    ) {
      frontmatter["related-to"] = [bestMatch.file.frontmatter.id];
      const newContent = serializeMarkdown(frontmatter, fact);
      await this.store.write(filePath, newContent);
      await this.generateIndex();
      return {
        action: "related",
        file: filePath,
        relatedTo: bestMatch.file.path,
      };
    }

    // Low similarity → create independently
    const newContent = serializeMarkdown(frontmatter, fact);
    await this.store.write(filePath, newContent);
    await this.generateIndex();
    return { action: "created", file: filePath };
  }

  /**
   * Semantic search over all memory files.
   * Brute-force with hash embeddings — fast enough for <500 files.
   */
  async search(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
    const limit = opts.limit ?? 10;
    const scopeFilter = opts.scope;
    const queryEmbedding = this.embed(query);
    const files = await this.loadAll();

    const scored: SearchResult[] = [];
    for (const file of files) {
      if (scopeFilter && !scopeFilter.includes(file.frontmatter.scope)) {
        continue;
      }
      const fileEmbedding = this.embed(file.content);
      const score = cosineSimilarity(queryEmbedding, fileEmbedding);
      const age = memoryAge(file.frontmatter.created ?? new Date().toISOString());
      scored.push({
        file: file.path,
        content: file.content,
        scope: file.frontmatter.scope,
        score: Math.round(score * 1000) / 1000,
        age: age.label,
        stalenessCaveat: age.stalenessCaveat,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Assemble context within a token budget.
   * Rough token estimate: 1 token ~= 4 chars.
   */
  async pack(opts: PackOpts = {}): Promise<string> {
    const budget = opts.budget ?? 4000;
    const charBudget = budget * 4;

    let files: MemoryFile[];
    if (opts.query) {
      const results = await this.search(opts.query, { limit: 50 });
      const allFiles = await this.loadAll();
      const fileMap = new Map(allFiles.map((f) => [f.path, f]));
      files = results
        .map((r) => fileMap.get(r.file))
        .filter((f): f is MemoryFile => f !== undefined);
    } else {
      files = await this.loadAll();
      // Sort by scope priority (user > agent > session > task), then recency
      const scopePriority: Record<string, number> = {
        user: 0,
        agent: 1,
        session: 2,
        task: 3,
      };
      files.sort((a, b) => {
        const sp =
          (scopePriority[a.frontmatter.scope] ?? 9) -
          (scopePriority[b.frontmatter.scope] ?? 9);
        if (sp !== 0) return sp;
        return (b.frontmatter.created ?? "").localeCompare(
          a.frontmatter.created ?? "",
        );
      });
    }

    const lines: string[] = ["# Agent Memory Context", ""];
    let totalChars = lines.join("\n").length;

    for (const file of files) {
      const age = memoryAge(
        file.frontmatter.created ?? new Date().toISOString(),
      );
      const caveat = age.stalenessCaveat ? ` (${age.stalenessCaveat})` : "";
      const entry = `- **[${file.frontmatter.scope}]** ${file.content}${caveat}`;

      if (totalChars + entry.length + 1 > charBudget) break;
      lines.push(entry);
      totalChars += entry.length + 1;
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Garbage collection — merge duplicates, archive superseded, expire old.
   */
  async consolidate(): Promise<ConsolidateResult> {
    const files = await this.loadAll();
    let merged = 0;
    let archived = 0;
    let expired = 0;

    // 1. Find superseded files (files whose ID appears in another's supersedes)
    const activeIds = new Set(files.map((f) => f.frontmatter.id));
    const supersededIds = new Set(
      files
        .map((f) => f.frontmatter.supersedes)
        .filter((s): s is string => !!s),
    );

    // 2. Archive files that have been superseded by other files
    for (const file of files) {
      if (supersededIds.has(file.frontmatter.id)) {
        const archivePath = `.db0/archive/${file.path}`;
        const raw = await this.store.read(file.path);
        await this.store.write(archivePath, raw);
        await this.store.delete(file.path);
        archived++;
      }
    }

    // 3. Expire session/task files older than 24h
    const now = new Date();
    for (const file of files) {
      if (
        file.frontmatter.scope === "session" ||
        file.frontmatter.scope === "task"
      ) {
        const created = new Date(file.frontmatter.created ?? 0);
        const ageHours =
          (now.getTime() - created.getTime()) / (1000 * 60 * 60);
        if (ageHours > 24) {
          await this.store.delete(file.path);
          expired++;
        }
      }
    }

    // 4. Find near-duplicates and merge
    const remaining = await this.loadAll();
    const consumed = new Set<string>();
    for (let i = 0; i < remaining.length; i++) {
      if (consumed.has(remaining[i].path)) continue;
      const embI = this.embed(remaining[i].content);
      for (let j = i + 1; j < remaining.length; j++) {
        if (consumed.has(remaining[j].path)) continue;
        const embJ = this.embed(remaining[j].content);
        const sim = cosineSimilarity(embI, embJ);
        if (sim >= this.highThreshold) {
          // Keep the newer one, archive the older
          const newer =
            (remaining[i].frontmatter.created ?? "") >=
            (remaining[j].frontmatter.created ?? "")
              ? remaining[i]
              : remaining[j];
          const older = newer === remaining[i] ? remaining[j] : remaining[i];
          await this.store.delete(older.path);
          consumed.add(older.path);
          merged++;
        }
      }
    }

    await this.generateIndex();
    return { merged, archived, expired };
  }

  /** Generate MEMORIES.md index file. */
  async generateIndex(): Promise<void> {
    const files = await this.loadAll();
    const byScope: Record<string, MemoryFile[]> = {};
    const stale: MemoryFile[] = [];

    for (const file of files) {
      const scope = file.frontmatter.scope ?? "unknown";
      if (!byScope[scope]) byScope[scope] = [];
      byScope[scope].push(file);

      const age = memoryAge(
        file.frontmatter.created ?? new Date().toISOString(),
      );
      if (age.days > 7) stale.push(file);
    }

    const lines: string[] = [
      "# Memories",
      "",
      `> ${files.length} active${stale.length > 0 ? `, ${stale.length} stale` : ""} | last updated ${new Date().toISOString()}`,
      "",
    ];

    const scopeOrder: MemoryScope[] = ["user", "agent", "session", "task"];
    for (const scope of scopeOrder) {
      const group = byScope[scope];
      if (!group || group.length === 0) continue;
      lines.push(`## ${scope} (${group.length})`);
      for (const file of group) {
        const age = memoryAge(
          file.frontmatter.created ?? new Date().toISOString(),
        );
        const preview =
          file.content.length > 80
            ? file.content.slice(0, 77) + "..."
            : file.content;
        lines.push(`- [${file.path.split("/").pop()}](${file.path}) — ${preview} (${age.label})`);
      }
      lines.push("");
    }

    if (stale.length > 0) {
      lines.push("## stale (>7 days)");
      for (const file of stale) {
        const age = memoryAge(file.frontmatter.created ?? new Date().toISOString());
        const preview =
          file.content.length > 60
            ? file.content.slice(0, 57) + "..."
            : file.content;
        lines.push(`- [${file.path.split("/").pop()}](${file.path}) — ${preview} (${age.label})`);
      }
      lines.push("");
    }

    await this.store.write("MEMORIES.md", lines.join("\n") + "\n");
  }
}
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run packages/md/__tests__/remember.test.ts packages/md/__tests__/search.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/md/src/memory-store.ts packages/md/__tests__/remember.test.ts packages/md/__tests__/search.test.ts
git commit -m "feat(md): implement MemoryStore with remember, search, pack, consolidate"
```

---

### Task 5: Pack and Consolidate Tests

**Files:**
- Create: `packages/md/__tests__/pack.test.ts`
- Create: `packages/md/__tests__/consolidate.test.ts`
- Create: `packages/md/__tests__/memories-index.test.ts`

- [ ] **Step 1: Write pack tests**

Create `packages/md/__tests__/pack.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryStore.pack", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-test-"));
    store = new MemoryStore({ dir });
    await store.remember("User prefers Rust", { scope: "user" });
    await store.remember("Deploy to AWS us-east-1", { scope: "agent" });
    await store.remember("Current task is fixing auth bug", {
      scope: "session",
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("assembles all memories into context", async () => {
    const context = await store.pack();
    expect(context).toContain("Rust");
    expect(context).toContain("AWS");
    expect(context).toContain("auth bug");
  });

  it("respects token budget", async () => {
    // Very small budget — should truncate
    const context = await store.pack({ budget: 20 });
    // 20 tokens ~= 80 chars, should fit header + maybe 1 entry
    const lines = context.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("query-based pack returns relevant results", async () => {
    const context = await store.pack({ query: "programming language" });
    expect(context).toContain("Rust");
  });
});
```

- [ ] **Step 2: Write consolidate tests**

Create `packages/md/__tests__/consolidate.test.ts`:

```typescript
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
    dir = mkdtempSync(join(tmpdir(), "db0-md-test-"));
    contentStore = new LocalContentStore(dir);
    store = new MemoryStore({ dir, contentStore });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("expires old session files", async () => {
    // Write a session memory with old timestamp
    const old = serializeMarkdown(
      {
        id: "m_old",
        scope: "session",
        created: "2020-01-01T00:00:00Z",
      },
      "Old session fact",
    );
    await contentStore.write("session/old-fact.md", old);

    const result = await store.consolidate();
    expect(result.expired).toBe(1);
    expect(existsSync(join(dir, "session/old-fact.md"))).toBe(false);
  });

  it("preserves recent session files", async () => {
    await store.remember("Current task context", { scope: "session" });
    const result = await store.consolidate();
    expect(result.expired).toBe(0);
  });

  it("regenerates MEMORIES.md", async () => {
    await store.remember("A fact", { scope: "user" });
    await store.consolidate();
    expect(existsSync(join(dir, "MEMORIES.md"))).toBe(true);
  });
});
```

- [ ] **Step 3: Write MEMORIES.md generation test**

Create `packages/md/__tests__/memories-index.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MEMORIES.md generation", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db0-md-test-"));
    store = new MemoryStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates MEMORIES.md after remember", async () => {
    await store.remember("User prefers Rust", { scope: "user" });
    const index = readFileSync(join(dir, "MEMORIES.md"), "utf8");
    expect(index).toContain("# Memories");
    expect(index).toContain("## user (1)");
    expect(index).toContain("Rust");
  });

  it("groups by scope", async () => {
    await store.remember("Fact A", { scope: "user" });
    await store.remember("Fact B", { scope: "agent" });
    const index = readFileSync(join(dir, "MEMORIES.md"), "utf8");
    expect(index).toContain("## user (1)");
    expect(index).toContain("## agent (1)");
  });

  it("shows total count", async () => {
    await store.remember("Fact A", { scope: "user" });
    await store.remember("Fact B", { scope: "user" });
    const index = readFileSync(join(dir, "MEMORIES.md"), "utf8");
    expect(index).toContain("2 active");
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run packages/md/__tests__/`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/md/__tests__/pack.test.ts packages/md/__tests__/consolidate.test.ts packages/md/__tests__/memories-index.test.ts
git commit -m "test(md): add pack, consolidate, and MEMORIES.md generation tests"
```

---

### Task 6: CLI Binary

**Files:**
- Create: `packages/md/src/cli.ts`
- Modify: `packages/md/src/index.ts`

- [ ] **Step 1: Implement CLI**

Create `packages/md/src/cli.ts`:

```typescript
#!/usr/bin/env node
import { MemoryStore } from "./memory-store.js";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function getFlagList(name: string): string[] | undefined {
  const val = getFlag(name);
  if (!val) return undefined;
  return val.split(",").map((s) => s.trim());
}

const dir = getFlag("dir") ?? "./memories";

async function main() {
  const store = new MemoryStore({ dir });

  switch (command) {
    case "remember": {
      const fact = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      if (!fact) {
        console.error("Usage: db0-md remember <fact> [--scope user] [--tags a,b] [--dir ./memories]");
        process.exit(1);
      }
      const scope = (getFlag("scope") ?? "user") as "user" | "agent" | "session" | "task";
      const tags = getFlagList("tags");
      const result = await store.remember(fact, { scope, tags: tags ?? undefined });

      if (result.action === "superseded") {
        console.log(`Superseded: ${result.file}`);
        console.log(`  was: ${result.superseded!.content}`);
        console.log(`  now: ${fact}`);
      } else if (result.action === "related") {
        console.log(`Created: ${result.file} (related to ${result.relatedTo})`);
      } else {
        console.log(`Created: ${result.file}`);
      }
      break;
    }

    case "search": {
      const query = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      if (!query) {
        console.error("Usage: db0-md search <query> [--limit 10] [--scope user,agent] [--dir ./memories]");
        process.exit(1);
      }
      const limit = parseInt(getFlag("limit") ?? "10", 10);
      const scopeList = getFlagList("scope") as ("user" | "agent" | "session" | "task")[] | undefined;
      const results = await store.search(query, { limit, scope: scopeList ?? undefined });

      if (results.length === 0) {
        console.log("No results found.");
      } else {
        for (const r of results) {
          const caveat = r.stalenessCaveat ? ` ⚠️` : "";
          const preview = r.content.length > 80 ? r.content.slice(0, 77) + "..." : r.content;
          console.log(`  ${r.score.toFixed(3)}  [${r.scope}]  ${preview}  (${r.age})${caveat}`);
          console.log(`         ${r.file}`);
        }
      }
      break;
    }

    case "pack": {
      const query = args.slice(1).filter((a) => !a.startsWith("--")).join(" ") || undefined;
      const budget = parseInt(getFlag("budget") ?? "4000", 10);
      const context = await store.pack({ query, budget });
      process.stdout.write(context);
      break;
    }

    case "consolidate": {
      const result = await store.consolidate();
      if (getFlag("quiet") === undefined) {
        console.log(`Consolidated: merged=${result.merged}, archived=${result.archived}, expired=${result.expired}`);
      }
      break;
    }

    case "index": {
      await store.generateIndex();
      console.log("MEMORIES.md regenerated.");
      break;
    }

    default:
      console.log(`db0-md — the embedded memory primitive for AI agents

Commands:
  remember <fact>      Smart write with dedup and superseding
  search <query>       Semantic search over memories
  pack [query]         Assemble context within a token budget
  consolidate          Garbage collection and cleanup
  index                Regenerate MEMORIES.md

Options:
  --dir <path>         Memory directory (default: ./memories)
  --scope <scope>      Memory scope: user, agent, session, task
  --tags <a,b>         Comma-separated tags
  --limit <n>          Max results for search
  --budget <n>         Token budget for pack
  --quiet              Suppress output`);
      break;
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
```

- [ ] **Step 2: Update index.ts with full exports**

Update `packages/md/src/index.ts`:

```typescript
export { MemoryStore } from "./memory-store.js";
export type { MemoryStoreOpts, RememberOpts, SearchOpts, PackOpts } from "./memory-store.js";

export { LocalContentStore } from "./content-store.js";
export type { ContentStore } from "./content-store.js";

export { parseMarkdown, serializeMarkdown } from "./markdown.js";

export type {
  MemoryScope,
  MemoryFrontmatter,
  MemoryFile,
  RememberResult,
  SearchResult,
  ConsolidateResult,
} from "./types.js";
```

- [ ] **Step 3: Build and test CLI manually**

Run:
```bash
npm run build -w packages/md
mkdir -p /tmp/test-memories
node packages/md/dist/cli.js remember "User prefers Rust" --dir /tmp/test-memories --scope user
node packages/md/dist/cli.js remember "User prefers Python" --dir /tmp/test-memories --scope user
node packages/md/dist/cli.js search "language" --dir /tmp/test-memories
node packages/md/dist/cli.js pack --dir /tmp/test-memories
cat /tmp/test-memories/MEMORIES.md
```

Expected: Second `remember` shows "Superseded" message. Search returns results. Pack outputs context. MEMORIES.md exists with entries.

- [ ] **Step 4: Commit**

```bash
git add packages/md/src/cli.ts packages/md/src/index.ts
git commit -m "feat(md): add CLI binary with remember, search, pack, consolidate, index commands"
```

---

### Task 7: Run Full Test Suite and Final Polish

**Files:**
- Modify: `packages/md/src/index.ts` (if needed)
- No new files

- [ ] **Step 1: Run all md tests**

Run: `npx vitest run packages/md/__tests__/`
Expected: All tests PASS.

- [ ] **Step 2: Run full monorepo tests**

Run: `npx vitest run`
Expected: All existing tests still pass + new md tests pass.

- [ ] **Step 3: Build all packages**

Run: `npm run build -w packages/core && npm run build -w packages/md`
Expected: Clean build, no errors.

- [ ] **Step 4: End-to-end CLI smoke test**

Run:
```bash
rm -rf /tmp/db0-e2e && mkdir /tmp/db0-e2e
node packages/md/dist/cli.js remember "User prefers TypeScript" --dir /tmp/db0-e2e --scope user
node packages/md/dist/cli.js remember "Always use vitest for testing" --dir /tmp/db0-e2e --scope agent
node packages/md/dist/cli.js remember "User prefers Rust" --dir /tmp/db0-e2e --scope user
node packages/md/dist/cli.js search "programming language" --dir /tmp/db0-e2e
node packages/md/dist/cli.js pack --budget 2000 --dir /tmp/db0-e2e
node packages/md/dist/cli.js consolidate --dir /tmp/db0-e2e
cat /tmp/db0-e2e/MEMORIES.md
ls -la /tmp/db0-e2e/user/ /tmp/db0-e2e/agent/
```

Expected:
- Third `remember` supersedes "TypeScript" with "Rust"
- Search returns "Rust" as top result
- Pack outputs context blob
- MEMORIES.md shows 2 active memories
- Directory structure: `user/` and `agent/` dirs with .md files

- [ ] **Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(md): complete db0/md prototype — smart memory lifecycle for AI agents"
```
