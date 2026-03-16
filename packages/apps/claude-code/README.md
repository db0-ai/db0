# @db0-ai/claude-code

Agent-native memory, state, and logging for Claude Code — powered by db0.

## Installation

### Option A: MCP Server (fastest, works today)

Run in Claude Code:

```
claude mcp add --transport stdio db0 -- npx -y @db0-ai/claude-code
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "db0": {
      "command": "npx",
      "args": ["-y", "@db0-ai/claude-code"]
    }
  }
}
```

This gives you all 9 MCP tools immediately. No signup, no API key.

### Option B: Full Plugin (tools + skills + hooks)

```
/plugin marketplace add db0-ai/db0
/plugin install db0@db0-ai-db0
```

This adds MCP tools plus skills (`/db0:inspect`, `/db0:ingest`) and hooks.

### Option C: Local Development

```bash
claude --plugin-dir ./packages/apps/claude-code
```

### Verify it works

After installation, ask Claude: "what db0 tools do you have?" — it should list 9 tools starting with `db0_`.

That's it. Claude Code now has persistent, scoped memory that survives across sessions.

### Upgrade

```bash
# Upgrade via the db0 CLI
npx @db0-ai/openclaw upgrade claude-code
```

Or manually re-add the MCP server — `npx -y` always fetches the latest version.

### Uninstall

```bash
# Remove MCP server config and database
npx @db0-ai/openclaw uninstall claude-code
```

This removes the `db0` entry from `~/.claude/settings.json` and deletes `~/.claude/db0.sqlite`.

## What You Get

- **9 MCP tools** — full memory CRUD, semantic search, state checkpoints, structured logging
- **Persistent storage** — SQLite at `~/.claude/db0.sqlite`, survives restarts and sessions
- **Scoped memory** — 4 scopes (task/session/user/agent) with different lifetimes
- **Memory superseding** — correct stale facts while preserving full audit trail
- **Semantic search** — built-in hash embeddings, zero API calls, zero config
- **L0 summaries** — auto-generated one-line summaries for token-efficient recall
- **State checkpoints** — save and restore execution progress
- **Structured logging** — full audit trail of agent activity
- **Skills** — `/db0:inspect` to browse memories, `/db0:ingest` to store facts

## Tools

| Tool | Description |
|---|---|
| `db0_memory_write` | Store a fact with scope, tags, summary, and optional superseding |
| `db0_memory_search` | Semantic search across memories with scope/tag filtering |
| `db0_memory_list` | List memories by scope |
| `db0_memory_get` | Get a specific memory by ID |
| `db0_memory_delete` | Delete a memory |
| `db0_memory_stats` | Memory statistics by scope and status |
| `db0_state_checkpoint` | Create a state checkpoint |
| `db0_state_restore` | Restore the most recent checkpoint |
| `db0_log_query` | Query structured log entries |

## Skills

### `/db0:inspect`

Browse and search agent memories. Use when you want to see what Claude remembers.

```
/db0:inspect dark mode preference
```

### `/db0:ingest`

Extract and store durable facts from text. Use when you want Claude to remember something.

```
/db0:ingest I prefer TypeScript with strict mode and always use bun as my package manager
```

## Memory Scopes

| Scope | Lifetime | Use case |
|---|---|---|
| `user` | Permanent, cross-session | Preferences, decisions, personal context |
| `agent` | Permanent, all sessions | Agent-specific patterns, learned behaviors |
| `session` | Current session | In-progress decisions, temporary context |
| `task` | Current task | Scratch work, intermediate results |

## Memory Superseding

When facts change, old memories are marked superseded — not deleted. Full audit trail preserved.

```
You: "remember I prefer dark mode"
→ db0_memory_write({ content: "User prefers dark mode", scope: "user" })

You: "actually I switched to light mode"
→ db0_memory_search("dark mode preference") → finds old memory
→ db0_memory_write({ content: "User prefers light mode", scope: "user", supersedes: "<old-id>" })
```

The old memory is preserved but excluded from search by default. Include `includeSuperseded: true` to see history.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB0_STORAGE` | `~/.claude/db0.sqlite` | Storage path. PostgreSQL connection string for cross-device sync. |
| `DB0_AGENT_ID` | `claude-code` | Agent identifier |
| `DB0_USER_ID` | OS username | Stable user identity for `user` scope isolation |

### PostgreSQL for cross-device memory

```json
{
  "mcpServers": {
    "db0": {
      "command": "npx",
      "args": ["-y", "@db0-ai/claude-code"],
      "env": {
        "DB0_STORAGE": "postgresql://user:pass@your-host/db0"
      }
    }
  }
}
```

## How It Compares

### Comparison Matrix

| | db0 | total-recall | Nemp | claude-memory-plugin | MemoryGraph | mem0 | CLAUDE.md |
|---|---|---|---|---|---|---|---|
| Storage | SQLite / Postgres | Unknown (tiered) | JSON files | YAML files | SQLite / Neo4j | Vector DB (cloud) | Plain text |
| Semantic search | Yes (built-in embeddings) | Unknown | Term expansion | Optional (Ollama) | Fuzzy matching | Yes (LLM-powered) | grep only |
| Memory scopes | 4 (task/session/user/agent) | Tiered | Flat | 5 scopes | Flat | 3 (user/session/agent) | None |
| Superseding | Yes (audit trail) | Correction propagation | No | No | No | No | Overwrites |
| State management | Checkpoints + branching | No | No | No | No | No | No |
| Structured logging | Yes | No | No | No | No | No | No |
| Requires LLM | No | Unknown | No | Optional | No | Yes | No |
| Requires account | No | No | No | No | No | Yes | No |
| Cross-device sync | Yes (Postgres) | No | No | No | No | Yes (cloud) | git |
| L0 summaries | Yes (auto-generated) | No | No | No | No | No | No |
| Stars | — | 185 | 76 | 5 | 163 | 49,300 | Built-in |

### vs. CLAUDE.md (built-in)

CLAUDE.md is static project instructions — plain text, no search, no scoping, no versioning. It works for "always use bun" but doesn't scale for dynamic, accumulated knowledge.

db0 and CLAUDE.md are **complementary**: CLAUDE.md for static project rules, db0 for dynamic agent knowledge that accumulates over time.

### vs. total-recall (185 stars)

The most popular Claude Code memory plugin. Has tiered memory and correction propagation. db0 differentiates with:
- **Real database storage** (SQLite/Postgres) instead of file-based
- **Semantic search** with built-in embeddings
- **State checkpoints** and structured logging beyond just memory
- **Cross-device sync** via Postgres
- **Programmable SDK** — same db0 database works from TypeScript, CLI, web inspector, and OpenClaw

### vs. Nemp Memory (76 stars)

100% local, JSON files, term-expansion search. Good for simplicity. db0 adds:
- **Actual semantic search** (not keyword expansion)
- **Scoped memory** with different lifetimes
- **Superseding** instead of overwriting
- **State management** and structured logging
- **Database-backed** — real queries, not file scanning

### vs. MemoryGraph (163 stars)

Graph-based MCP server with 8 backend options. Strong on relationships. db0 differentiates with:
- **Scoped memory** (task/session/user/agent) vs flat storage
- **Memory superseding** with audit trail
- **State checkpoints** and logging (not just memory)
- **L0 summaries** for token efficiency
- **Zero-config** — works out of the box without choosing backends or enabling modes

### vs. mem0 (49,300 stars)

The largest memory player. Cloud-first, LLM-required, account-required. db0 is the opposite:
- **Fully local** — data stays on your machine (or your own Postgres)
- **No LLM required** — built-in hash embeddings, zero API calls
- **No account needed** — no signup, no API key, no cloud dependency
- **More primitives** — state checkpoints, logging, superseding, typed relationships
- **Open SDK** — same database accessible from CLI, web inspector, OpenClaw, or any TypeScript project

### vs. claude-memory-plugin (5 stars)

YAML-based with 5 scopes and optional Ollama embeddings. Closest in scope ambition. db0 adds:
- **Database storage** instead of YAML files (real queries, concurrent access)
- **Built-in embeddings** (no external Ollama dependency)
- **Superseding** with audit trail
- **State management** and structured logging
- **Hybrid search** (similarity + recency + popularity scoring)
- **Cross-device sync** via Postgres

## Architecture

```
Claude Code
  │
  │ MCP protocol (stdio)
  │
  ▼
db0 MCP Server
  │
  ├── memory tools  → db0 harness → memory()
  ├── state tools   → db0 harness → state()
  └── log tools     → db0 harness → log()
  │
  ▼
SQLite (local) or PostgreSQL + pgvector (cloud)
```

## Part of the db0 ecosystem

This plugin is one entry point to the db0 SDK. The same memory database is compatible with:

| Package | Description |
|---|---|
| `@db0-ai/core` | Core SDK — use db0 programmatically in any TypeScript project |
| `@db0-ai/openclaw` | OpenClaw ContextEngine plugin for full context lifecycle |
| `@db0-ai/inspector` | Web UI for browsing memory, state, and logs |
| `@db0-ai/cli` | CLI for memory operations |
| `@db0-ai/backends-sqlite` | SQLite backend (default) |
| `@db0-ai/backends-postgres` | PostgreSQL + pgvector backend |

### Inspector Helper (Claude Profile)

Use the built-in helper to prefill inspector runtime profile/capabilities for Claude Code:

```ts
import { createInspector } from "@db0-ai/inspector";
import { createClaudeInspectorConfig } from "@db0-ai/claude-code";

const cfg = createClaudeInspectorConfig({ backend });
const inspector = createInspector(cfg);
const { url } = await inspector.start();
console.log(url);
```

## License

MIT
