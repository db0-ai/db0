# @db0-ai/db0

The `db0` CLI — a markdown-based memory store for AI agents.

Turn a directory of markdown files into managed agent memory with scoping, deduplication, superseding, and context packing. Zero config, zero external dependencies, files you can read with `ls`.

## Install

```bash
npm install -g @db0-ai/db0
```

Or use directly:

```bash
npx @db0-ai/db0 remember "User prefers dark mode"
```

## Commands

```bash
db0 remember "User prefers TypeScript" --scope user
db0 search "language preferences" --limit 5
db0 pack "current task context" --budget 2000
db0 consolidate
db0 index
```

### `remember <fact>`

Store a new memory. Automatically detects related or contradictory facts:

- **New fact** — creates a new markdown file with YAML frontmatter
- **Contradicts existing** — supersedes the old file (preserved for audit)
- **Related to existing** — links via `related-to` frontmatter field

```bash
db0 remember "User prefers dark mode" --scope user --tags ui,preferences
db0 remember "User prefers light mode"   # supersedes the previous fact
```

Options: `--scope` (user/agent/session/task), `--tags` (comma-separated), `--dir`

### `search <query>`

Search memories by semantic similarity. Results include score, scope, content preview, age, and staleness warnings.

```bash
db0 search "UI preferences" --limit 5 --scope user
```

Options: `--limit`, `--scope`, `--dir`

### `pack [query]`

Assemble memories into a context block for LLM consumption. Pipe-friendly — outputs to stdout.

```bash
db0 pack "current project" --budget 2000 | pbcopy
db0 pack --budget 4000 > context.md
```

Without a query, packs all memories ordered by scope priority then recency. With a query, orders by relevance.

Options: `--budget` (token budget, default 4000), `--scope`, `--dir`

### `consolidate`

Clean up superseded, expired, and duplicate memories:

- Archives superseded files to `.db0/archive/`
- Expires old session/task memories (>24h)
- Merges near-duplicates within the same scope

```bash
db0 consolidate --dir ./memories
```

Options: `--quiet`, `--dir`

### `index`

Regenerate the `MEMORIES.md` index file — a human-readable table of contents grouped by scope.

```bash
db0 index --dir ./memories
```

## Storage Model

```
memories/
  user/
    prefer-dark-mode.md
    prefer-typescript.md
  session/
    current-task-notes.md
  MEMORIES.md              ← auto-generated index
  .db0/                    ← derived data (archive, cache)
```

Each memory is a markdown file with YAML frontmatter:

```markdown
---
id: m_abc123
scope: user
tags: [ui, preferences]
created: 2025-01-15T10:30:00Z
---

User prefers dark mode for all IDE and terminal interfaces.
```

Frontmatter fields: `id`, `scope`, `tags`, `created`, `supersedes`, `related-to`, `expires`

## Programmatic API

```typescript
import { MemoryStore } from "@db0-ai/db0";

const store = new MemoryStore({ dir: "./memories" });

await store.remember("User prefers TypeScript", { scope: "user" });

const results = await store.search("language preferences", { limit: 5 });

const context = await store.pack({ query: "current task", tokenBudget: 2000 });

await store.consolidate();
```

## Design Principles

- **Files are the source of truth** — not a database, not a cache. `ls memories/` tells you everything.
- **Zero config** — works out of the box with sensible defaults.
- **Lifecycle over retrieval** — deduplication, superseding, expiration, and consolidation are first-class.
- **Everything rebuildable** — `.db0/` and `MEMORIES.md` are derived from the markdown files.

## Documentation

See the [main db0 README](https://github.com/db0-ai/db0) for full documentation.

## License

MIT
