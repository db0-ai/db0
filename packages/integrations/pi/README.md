# @db0-ai/pi

## The Problem

Pi is a powerful coding agent, but it has [the memory of a goldfish](https://github.com/badlogic/pi-mono/issues/1182). Close the session? Forgotten. Switch projects? Forgotten. That API pattern you explained yesterday? Gone.

Several developers have built [independent](https://github.com/lebonbruce/pi-hippocampus) [memory](https://github.com/jayzeng/pi-memory) extensions to fix this. The core issues:

- **No cross-session memory.** Every new session starts blank. AGENTS.md is static — it doesn't learn or update from conversations. Developers [repeat themselves constantly](https://github.com/badlogic/pi-mono/issues/1182).
- **Compaction destroys context.** Long sessions exhaust the context window. Pi's compaction summarizes older messages, but it's [explicitly lossy](https://github.com/badlogic/pi-mono/issues/92) — facts get dropped. Tool results (often the most important content) are [truncated to 2000 characters](https://github.com/badlogic/pi-mono/issues/116).
- **No semantic search over history.** Past sessions are stored as JSONL files, but there's no way to search them by meaning. You can browse with `/tree` and `/resume`, but the agent can't recall relevant knowledge from 50 sessions ago.
- **The maintainer wants memory as an extension, not core.** A [proposal to add memory to Pi core](https://github.com/badlogic/pi-mono/issues/1255) was rejected. Memory is explicitly an extension concern — which is where db0 fits.

`@db0-ai/pi` is a Pi extension that gives your coding agent persistent, scoped memory with automatic fact extraction. One install, SQLite storage, no external services.

## Quick Start

### Install

```bash
mkdir -p ~/.pi/agent/extensions/db0
cd ~/.pi/agent/extensions/db0
npm init -y
npm install @db0-ai/pi
```

Create `~/.pi/agent/extensions/db0/index.js`:

```javascript
const { createDb0PiExtension } = require("@db0-ai/pi");

module.exports = async function register(pi) {
  const ext = await createDb0PiExtension();
  ext.register(pi);
};
```

Restart Pi. Ask: "what db0 tools do you have?" — it should list 3 tools.

## What You Get

- **Your coding agent remembers** — preferences, patterns, and project context persist across sessions
- **Facts survive compaction** — extracted before messages are discarded, not after
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
| `session_before_compact` | Logs compaction events |
| `session_start` | Creates fresh harness (memories persist) |
| `session_shutdown` | Runs reconciliation, closes cleanly |

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

### Surviving long sessions

Pi's compaction discards old messages to free context. db0 extracts facts before they're lost.

```
[100 messages in, compaction triggers]
→ db0 has already extracted key facts from every turn
→ After compaction: conversation is shorter, but knowledge is preserved in db0
→ Agent can search for any fact from the discarded portion
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

## Configuration

```javascript
const ext = await createDb0PiExtension({
  dbPath: "~/.pi/agent/db0.sqlite",  // default
  tokenBudget: 1500,                  // tokens for context injection
  // profile: PROFILE_CODING_ASSISTANT  // default — high precision, slow decay
});
```

### PostgreSQL for Cross-Device Sync

```javascript
const { createPostgresBackend } = require("@db0-ai/backends-postgres");

const backend = await createPostgresBackend(process.env.DATABASE_URL);
const ext = await createDb0PiExtension({ backend });
```

## How It Compares to pi-hippocampus

[pi-hippocampus](https://github.com/lebonbruce/pi-hippocampus) is the most popular Pi memory extension. db0 takes a different approach:

| | db0 | pi-hippocampus |
|---|---|---|
| Extraction | Rules-based, zero LLM calls | Requires Ollama 8B+ model |
| Search | Hash embeddings (local) or Gemini/OpenAI | Local embeddings (Xenova) + Ollama reranking |
| Memory model | 4 scopes + superseding + typed relationships | Facts/Rules/Events + forgetting curve |
| State management | Checkpoints + branching | No |
| Production backend | SQLite or PostgreSQL | SQLite only |
| Ecosystem | Same DB works with AI SDK, LangChain, OpenClaw, inspector | Pi-only |

Both solve the same core problem. db0 is simpler to set up (no Ollama dependency) and connects to the broader db0 ecosystem. pi-hippocampus has more sophisticated memory science (forgetting curves, sleep consolidation).

## Part of db0

This package is one entry point to the db0 SDK. The same memory database works with the [core SDK](../../core), [AI SDK integration](../ai-sdk), [LangChain integration](../langchain), [OpenClaw plugin](../../apps/openclaw), [Claude Code MCP server](../../apps/claude-code), [CLI](../../cli), and [inspector](../../inspector).

## License

MIT
