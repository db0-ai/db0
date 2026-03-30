# @db0-ai/pi

## The Problem

[Pi](https://github.com/badlogic/pi-mono) is an AI agent toolkit — coding agent CLI, unified LLM API, TUI & web UI libraries. Its coding agent is powerful, but has no built-in cross-session memory. Close the session and everything is gone — preferences, project patterns, solutions to bugs you've already fixed. AGENTS.md gives you static instructions, but it doesn't learn from conversations.

This has led developers to build their own memory extensions ([pi-hippocampus](https://github.com/lebonbruce/pi-hippocampus), [pi-memory](https://github.com/jayzeng/pi-memory), and others). The underlying issues:

- **No cross-session memory.** Every new session starts blank. AGENTS.md provides static project rules, but nothing that accumulates from conversations.
- **Compaction is lossy.** Long sessions exhaust the context window. Pi's compaction [summarizes older messages](https://github.com/badlogic/pi-mono/issues/92), but facts get dropped. Tool results — often the most valuable content — are [truncated to 2000 characters](https://github.com/badlogic/pi-mono/issues/116).
- **No semantic search over history.** Past sessions are stored as JSONL files. You can browse them with `/tree` and `/resume`, but the agent can't search them by meaning.
- **Memory is an extension concern, not core.** Pi's architecture deliberately keeps memory out of the core agent — it's designed to be solved by extensions.

`@db0-ai/pi` is a Pi extension that gives your coding agent persistent, scoped memory with automatic fact extraction. One install, SQLite storage, no external services.

## Quick Start

```bash
npx @db0-ai/pi init
```

One command. Creates the extension in `~/.pi/agent/extensions/db0/`, installs dependencies, and sets up the entry point. Restart Pi to activate.

Ask Pi: "what db0 tools do you have?" — it should list 3 tools.

### Manual Install

If you prefer to set it up yourself:

```bash
mkdir -p ~/.pi/agent/extensions/db0
cd ~/.pi/agent/extensions/db0
npm init -y && npm install @db0-ai/pi
```

Create `index.mjs`:

```javascript
import { createDb0PiExtension } from "@db0-ai/pi";

export default async function register(pi) {
  const ext = await createDb0PiExtension();
  ext.register(pi);
}
```

### Uninstall

```bash
npx @db0-ai/pi uninstall              # remove extension and database
npx @db0-ai/pi uninstall --keep-data   # remove extension, keep memories
```

## What You Get

- **Your coding agent remembers** — preferences, patterns, and project context persist across sessions
- **Facts are extracted every turn** — not just at compaction, so knowledge accumulates continuously
- **Semantic search** — the agent finds relevant memories by meaning, not just keywords
- **Scoped memory** — user preferences vs. project-specific vs. session-temporary, automatically isolated
- **Zero config** — works with built-in hash embeddings, no API keys, no external services

## Tools

Pi's LLM gets three tools to manage memory:

| Tool | What it does |
|---|---|
| `db0_memory_write` | Store a fact with scope and tags |
| `db0_memory_search` | Semantic search across all memories |
| `db0_memory_list` | List memories, optionally filtered by scope |

## Lifecycle Hooks

The extension hooks into Pi's event system automatically:

| Event | What db0 does |
|---|---|
| `before_agent_start` | Packs relevant memories into context |
| `turn_end` | Extracts facts from assistant responses |
| `session_start` | Creates fresh harness (memories persist across sessions) |
| `session_shutdown` | Runs reconciliation (merge duplicates, clean edges), closes cleanly |

## Use Cases

### Coding agent that remembers project patterns

You explain your architecture once. Next session, the agent already knows.

```
Session 1:
you: We use a monorepo with pnpm workspaces. Tests are in __tests__/ dirs.
     The API uses tRPC with Zod validation.
→ db0 extracts: monorepo/pnpm, test location, API stack

Session 2:
you: Add a new endpoint for user profiles
→ Agent recalls tRPC + Zod pattern, __tests__/ convention, pnpm workspace structure
```

### Never repeat your preferences

Stop telling the agent the same things every session.

```
you: I always use bun, not npm. Use single quotes. Prefer functional style.
→ Facts stored as user-scoped preferences

Every future session:
→ Agent automatically knows: bun, single quotes, functional style
```

### Cross-project knowledge

Fixed a tricky CORS issue in project A? The agent remembers when you hit something similar in project B.

```
Project A:
you: The CORS fix was to add the Access-Control-Allow-Credentials header
→ Stored in user scope (not project-specific)

Project B:
you: I'm getting CORS errors
→ db0_memory_search finds the previous fix from project A
```

### Superseding stale knowledge

Projects evolve. Old facts should be corrected, not duplicated.

```
Session 1:
you: We deploy to Heroku
→ Stored

Session 5:
you: We migrated to AWS last week
→ Agent supersedes the Heroku fact — old one preserved for audit, excluded from search
```

## Inspector

Browse, search, and manage your agent's memories in a web UI:

```bash
npx @db0-ai/inspector --db ~/.pi/agent/db0.sqlite
```

Opens at `http://127.0.0.1:6460` with three views: memories, dashboard, and health report. See [@db0-ai/inspector](../../inspector) for full options.

## Configuration

```javascript
import { createDb0PiExtension } from "@db0-ai/pi";

const ext = await createDb0PiExtension({
  dbPath: "~/.pi/agent/db0.sqlite",  // default
  tokenBudget: 1500,                  // tokens for context injection
  consolidateFn: async (memories) => {  // optional: LLM-assisted memory merging
    const res = await callOllama(`Merge these facts:\n${memories.map(m => m.content).join("\n")}`);
    return { content: res };
  },
});
```

### PostgreSQL for Cross-Device Sync

```javascript
import { createPostgresBackend } from "@db0-ai/backends-postgres";

const backend = await createPostgresBackend(process.env.DATABASE_URL);
const ext = await createDb0PiExtension({ backend });
```

## How It Compares to pi-hippocampus

[pi-hippocampus](https://github.com/lebonbruce/pi-hippocampus) is another Pi memory extension. db0 takes a different approach:

| | db0 | pi-hippocampus |
|---|---|---|
| Extraction | Rules-based, zero LLM calls | Requires Ollama 8B+ model |
| Search | Hash embeddings (local) or Gemini/OpenAI | Local embeddings (Xenova) + Ollama reranking |
| Memory model | 4 scopes + superseding + typed relationships | Facts/Rules/Events + forgetting curve |
| State management | Checkpoints + branching | No |
| Production backend | SQLite or PostgreSQL | SQLite only |
| Ecosystem | Same DB works with AI SDK, LangChain, OpenClaw, inspector | Pi-only |

db0 is simpler to set up (no Ollama dependency) and connects to the broader db0 ecosystem. pi-hippocampus has more sophisticated memory modeling (forgetting curves, sleep consolidation).

## Part of db0

This package is one entry point to the db0 SDK. The same memory database works with the [core SDK](../../core), [AI SDK integration](../ai-sdk), [LangChain integration](../langchain), [OpenClaw plugin](../../apps/openclaw), [Claude Code MCP server](../../apps/claude-code), [CLI](../../cli), and [inspector](../../inspector).

## License

MIT
