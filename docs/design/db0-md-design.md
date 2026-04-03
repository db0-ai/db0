# Design: db0/md — The Embedded Memory Primitive for AI Agents

**Status:** Prototype
**Branch:** `feat/db0-md-prototype`
**Date:** 2026-04-03

## Problem

Every AI agent that runs more than once needs memory. Today, three independent
billion-dollar agent systems (Manus, OpenClaw, Claude Code) converged on the same
architecture: markdown files in a directory. This works because files give agents
transparency, git history, portability, and zero infrastructure.

But files alone have no lifecycle. After weeks of use:

- Contradictions accumulate silently ("prefers Python" and "prefers Rust" coexist)
- Nobody cleans up — the directory only grows
- Search is grep (no semantic understanding)
- Context assembly is "cat everything and hope it fits"
- The agent doesn't know which facts are stale

The tools that exist solve the wrong half of the problem. QMD, RAG pipelines, and
vector databases are excellent at **reading** — search and retrieval. Nobody has
built the **write-side primitives**: superseding stale facts, deduplicating on
write, scoping by lifetime, consolidating redundant memories, and assembling
coherent context within a token budget.

Mem0 and Zep are cloud services. Letta is a framework. LangChain memory modules
are abandoned by frustrated developers. There is no embedded, zero-config,
local-first memory primitive — no "SQLite for agent memory."

## Product Thesis

**db0/md is a CLI tool that turns a directory of markdown files into a managed
memory system.**

Agents keep reading and writing markdown files. db0 adds the lifecycle:
smart write (dedup + supersede), search, context assembly, and garbage collection.

The entry point is the "wow moment" — catching a contradiction in under 60 seconds:

```bash
npx db0 remember "User prefers Rust" --dir ./memories
# Created memories/user/language-prefs.md

npx db0 remember "User prefers Python" --dir ./memories
# Conflicts with memories/user/language-prefs.md ("User prefers Rust")
# Superseded. Updated memories/user/language-prefs.md
```

## Design Principles

1. **Files are the source of truth.** Not a database. Not a cache export. Real
   markdown files that you can open in VS Code, browse on GitHub, copy with `cp`.

2. **Zero config.** Point at a directory, get value. No init, no config file,
   no database to provision.

3. **The interface is filesystem-shaped.** Agents interact through familiar
   operations: read files, write files, grep, ls. The CLI extends this with
   `remember`, `search`, `pack`, `consolidate`.

4. **Everything derived is rebuildable.** If `.db0/` is deleted, `db0 index`
   rebuilds from the markdown files. The files are always sufficient.

5. **Lifecycle, not retrieval.** Search is table stakes (included but not the
   differentiator). The value is write-side: dedup, supersede, scope, consolidate.

6. **Works with every agent runtime.** Claude Code, Codex, OpenClaw, Gemini CLI,
   custom agents — anything with shell + filesystem access.

## Architecture

```
                          ┌─────────────────────┐
                          │   Agent Runtime      │
                          │ (Claude Code, Codex, │
                          │  OpenClaw, custom)   │
                          └──────────┬──────────┘
                                     │
                    reads/writes files + calls db0 CLI
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
   │  Markdown Files   │   │   db0 CLI        │   │  MEMORIES.md     │
   │  (source of truth)│   │                  │   │  (auto-generated │
   │                   │   │  remember        │   │   index file)    │
   │  memories/        │   │  search          │   │                  │
   │    user/          │   │  pack            │   │                  │
   │    agent/         │   │  consolidate     │   │                  │
   │    session/       │   │  index           │   │                  │
   │    task/          │   │                  │   │                  │
   └──────────┬────────┘   └────────┬─────────┘   └──────────────────┘
              │                     │
              │    ┌────────────────┘
              │    │
              ▼    ▼
   ┌──────────────────────────────────────┐
   │  .db0/  (derived, rebuildable)       │
   │                                      │
   │  index.sqlite  — embeddings, FTS,    │
   │                   metadata cache     │
   │  manifest.json — file hashes,        │
   │                   last-sync state    │
   └──────────────────────────────────────┘
```

### Storage Model

**Markdown files own content.** Each file is one memory:

```markdown
---
id: m_a1b2c3
scope: user
tags: [preference, language]
created: 2026-04-03T10:00:00Z
supersedes: m_x9y8z7
---

User prefers Rust for CLI tools. Switched from Python in March 2026.
```

Frontmatter carries metadata. Body is the memory content. An agent can write a
file with just body + `scope:` — db0 fills in id, created, and other fields on
the next `index` or `remember` run.

**Directory structure is scoping:**

```
memories/
  user/           # permanent, cross-session
  agent/          # permanent, agent-level knowledge
  session/        # current session (auto-expires)
  task/           # current task (auto-expires)
```

**SQLite owns derived data.** Embeddings, FTS index, access counts, similarity
scores. Stored in `.db0/index.sqlite`. Rebuildable from files via `db0 index`.

**MEMORIES.md is the auto-generated index.** One file an agent reads to get all
context. Auto-maintained after every write or consolidate.

### Relationship to @db0-ai/core

db0/md wraps `@db0-ai/core` internally:

- `Memory` component provides superseding, scoping, dedup logic
- `hashEmbed` / `defaultEmbeddingFn` provides zero-dep embeddings
- `memoryAge` provides staleness tracking
- Extraction strategies (rules/LLM) provide fact extraction
- Consolidation (reconcile + consolidateFn) provides garbage collection
- SQLite backend provides the index cache

The user never sees core. They see markdown files + CLI commands.

### ContentStore Abstraction

All file operations go through an interface to enable future S3 migration:

```typescript
interface ContentStore {
  read(key: string): Promise<string>;
  write(key: string, content: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}
```

v1: `LocalContentStore` (fs.readFile/writeFile)
Future: `S3ContentStore`, with local `.db0/` SQLite as read cache.

## CLI Primitives

### `db0 remember <fact> [--scope user|agent|session|task] [--tags a,b] [--dir ./memories]`

The smart write. The core differentiator.

1. Compute hash embedding of the input fact
2. Scan existing memories (via index if available, brute-force if not)
3. Threshold-based decision:
   - **High similarity (>0.9):** auto-supersede. Update the existing file. Commit
     old version to git if available.
   - **Medium similarity (0.7-0.9):** create new file with `related-to:` frontmatter
     linking to the similar memory.
   - **Low similarity (<0.7):** create new file independently.
4. Update `.db0/` index
5. Regenerate MEMORIES.md

### `db0 search <query> [--limit N] [--scope ...] [--dir ./memories]`

Semantic + keyword search over the memory directory.

1. If `.db0/index.sqlite` exists: use cached embeddings + FTS
2. If not: brute-force scan — read all files, compute hash embeddings on the fly,
   rank by cosine similarity
3. Return ranked results with file paths, scores, age, staleness caveats

For <500 files, brute-force with hash embeddings is <100ms. SQLite index is an
optimization, not a requirement.

### `db0 pack [--query <context>] [--budget <tokens>] [--dir ./memories]`

Context assembly for LLM prompts.

1. If query provided: search for relevant memories, rank by score
2. If no query: use all active memories, rank by recency + scope priority
3. Assemble into markdown, respecting token budget:
   - Skip superseded/contradicted facts
   - Prefer recent over old
   - Prefer user/agent scope over session/task
   - Include staleness warnings for old memories
4. Output markdown to stdout (pipe-friendly)

### `db0 consolidate [--dir ./memories]`

Garbage collection.

1. Cluster semantically similar files (using core's reconcile logic)
2. Merge redundant files (preserve the most complete version)
3. Move superseded files to `.db0/archive/`
4. Detect contradictions, flag for review
5. Remove expired session/task files
6. Regenerate MEMORIES.md

### `db0 index [--dir ./memories]`

Rebuild the search cache from files.

1. Scan all markdown files in the directory
2. Parse frontmatter + content
3. Compute embeddings (hash by default, pluggable)
4. Build FTS index
5. Write to `.db0/index.sqlite`

Idempotent, safe to run anytime. Required after manual file edits.

## MEMORIES.md Format

Auto-generated after every `remember`, `consolidate`, or `index`:

```markdown
# Memories

> 12 active, 3 archived | last updated 2026-04-03T10:00:00Z

## user (5)
- [language-prefs.md](user/language-prefs.md) — Prefers Rust for CLI tools (today)
- [work-style.md](user/work-style.md) — Short PRs, no squash (3 days ago)
- [github.md](user/github.md) — Uses lightcone0 for db0-ai (today)

## agent (4)
- [stack.md](agent/stack.md) — TypeScript monorepo, vitest (today)
- [patterns.md](agent/patterns.md) — Workspace packages pattern (2 days ago)

## session (2)
- [current-task.md](session/current-task.md) — Designing db0/md (today)

## stale (>7 days)
- [old-deploy.md](agent/old-deploy.md) — References src/old-config.ts (not found)
```

One file. Agent reads it, gets full context. Humans read it, see everything at a
glance.

## v1 Scope: Pure Files Mode

For the prototype, the simplest possible implementation:

- **No SQLite dependency.** Brute-force scan with hash embeddings on every
  operation. Fast enough for <500 files.
- **No config file.** Convention over configuration (directory structure = scoping).
- **No background process.** Every command is stateless, reads files, does work,
  writes files.
- **Single npm package.** `@db0-ai/md` with a `db0` CLI binary.
- **Zero external dependencies** beyond what's already in core.

### Growth Path

| | v1: Pure files | v1.5: SQLite accel | v2: Cloud |
|---|---|---|---|
| Storage | local markdown | local markdown | S3 / object store |
| Index | on-the-fly hash | .db0/index.sqlite | local cache + durable store |
| Search | brute-force cosine | BM25 + vector | same |
| Embeddings | hash (built-in) | pluggable (Ollama, OpenAI) | same |
| File limit | ~500 | ~10,000 | unlimited |
| Dependencies | zero | better-sqlite3 | + S3 SDK |

## Embedding Strategy

v1 uses `hashEmbed` from `@db0-ai/core` — deterministic, zero-API, instant.
Not semantic, but good enough for near-exact dedup and recall.

Pluggable upgrade path (v1.5+):

```typescript
// .db0.yml or programmatic
embedding:
  provider: ollama          # or openai, gemini
  model: nomic-embed-text
```

When a real embedding provider is configured, `db0 index` recomputes all
embeddings and stores them in `.db0/index.sqlite`.

## Agent Runtime Integration

### Claude Code
```json
// hooks.json — PostQuery hook
{ "command": "db0 consolidate --dir ${CLAUDE_PLUGIN_ROOT}/memories --quiet" }
```
Agent reads/writes `memories/` directory normally. db0 runs lifecycle in hooks.

### OpenClaw
```bash
# In the cron heartbeat
db0 consolidate --dir ./state/memories
```
Agent writes files, db0 manages lifecycle on the cron loop.

### Codex / Any Sandbox
```bash
# Agent calls db0 like any CLI tool
db0 remember "The API uses REST, not GraphQL" --scope agent
db0 search "API architecture"
db0 pack --budget 4000 | pbcopy  # pipe into prompt
```

### SDK (for framework developers)
```typescript
import { MemoryStore } from "@db0-ai/md";

const store = new MemoryStore({ dir: "./memories" });
await store.remember("User prefers Rust", { scope: "user" });
const results = await store.search("language preferences");
const context = await store.pack({ budget: 4000 });
```

## What This Is NOT

- **Not a RAG pipeline.** No document chunking, no ingestion of PDFs/HTML.
  It manages agent memories, not reference documents.
- **Not a vector database.** The index is a cache, not a product.
- **Not a framework.** No opinions on agent architecture, no lifecycle hooks
  to implement, no base classes to extend.
- **Not a cloud service.** Runs locally, your data stays on your machine.

## Success Criteria

1. `npx db0 remember` catches a contradiction in under 60 seconds on first use
2. Works with Claude Code, Codex, and OpenClaw without framework-specific code
3. Zero configuration, zero external dependencies
4. A developer can understand the entire system by reading `ls memories/`
5. MEMORIES.md is good enough that agents use it as their primary context source

## Prototype Plan

1. `@db0-ai/md` package with `MemoryStore` class wrapping core
2. `db0` CLI binary with five commands: remember, search, pack, consolidate, index
3. ContentStore interface with LocalContentStore implementation
4. MEMORIES.md generation
5. Tests: smart write dedup, superseding, search ranking, pack budget, consolidate merge
6. A demo: run db0 against a directory of memories, show the lifecycle loop
