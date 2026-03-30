# @db0-ai/claude-code

## Why

Without memory, every Claude Code session starts from zero. You explain your architecture, your preferences, the bug you debugged yesterday — and tomorrow you'll explain it all again.

**With db0, a 10-minute context-building ritual becomes instant.** Claude already knows your project uses PostgreSQL, that you prefer functional style, and that the CORS fix from last week was the `Access-Control-Allow-Credentials` header. No signup, no API keys, no cloud — your data stays in a local SQLite file.

## Quick Start

```
claude mcp add --transport stdio db0 -- npx -y @db0-ai/claude-code
```

That's it. Restart Claude Code. No account, no API key, no config file.

Or add to `.mcp.json`:

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

## How It Works

Just talk naturally. Claude uses the memory tools automatically:

```
You: "I always use bun, not npm. And remember that this project uses tRPC."
→ Claude stores both as user-scoped facts — visible in every future session.

You: "We switched from Heroku to AWS last week."
→ Claude supersedes the old Heroku fact. The old one is preserved for audit
  but excluded from search. No contradictions.

Next day, new session:
You: "Help me deploy this service"
→ Claude already knows: bun, tRPC, AWS. No re-explanation needed.
```

You don't need to say "call db0_memory_write." Just state your preferences, make decisions, or say "remember that..." — Claude uses the tools when it recognizes something worth remembering.

## What You Get

- **Zero setup, zero cost** — local SQLite, no API key, no cloud account, no usage limits
- **Your data stays on your machine** — nothing leaves localhost unless you choose Postgres
- **Claude remembers across sessions** — preferences, decisions, project context persist
- **Facts stay current** — when things change, old facts are superseded with full audit trail
- **Semantic search** — Claude finds relevant memories by meaning, not just keywords
- **Full visibility** — inspector UI and CLI to browse what Claude knows

## Tools

| Tool | Description |
|---|---|
| `db0_memory_write` | Store a fact with scope, tags, and optional superseding |
| `db0_memory_search` | Semantic search with scope/tag filtering |
| `db0_memory_update` | Update a fact — finds the old version, supersedes it, writes the new one |
| `db0_memory_list` | List memories by scope |
| `db0_memory_get` | Get a specific memory by ID |
| `db0_memory_delete` | Delete a memory |
| `db0_memory_stats` | Memory statistics by scope and status |
| `db0_state_checkpoint` | Create a state checkpoint |
| `db0_state_restore` | Restore the most recent checkpoint |
| `db0_log_query` | Query structured log entries |

## Skills

```
/db0:inspect dark mode preference     # browse what Claude remembers
/db0:ingest I prefer TypeScript       # tell Claude to remember something
```

## Memory Scopes

| Scope | Lifetime | Use case |
|---|---|---|
| `user` | Permanent, cross-session | Preferences, decisions, personal context |
| `agent` | Permanent, all sessions | Agent-specific patterns, learned behaviors |
| `session` | Current session | In-progress decisions, temporary context |
| `task` | Current task | Scratch work, intermediate results |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DB0_STORAGE` | `~/.claude/db0.sqlite` | Storage path or PostgreSQL connection string |
| `DB0_AGENT_ID` | `claude-code` | Agent identifier |
| `DB0_USER_ID` | OS username | User identity for scope isolation |

### Cross-device memory via PostgreSQL

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

## Inspector

```bash
npx @db0-ai/inspector --db ~/.claude/db0.sqlite
```

Browse, search, and manage Claude's memories in a web UI. See [@db0-ai/inspector](../../inspector).

## vs. Mem0 for Claude Code

| | db0 | Mem0 |
|---|---|---|
| **Setup** | `npx` — one command, done | pip install + API key + cloud signup |
| **Cost** | Free, unlimited | Free tier: 10K memories, 1K retrievals/month |
| **Data** | Local SQLite on your machine | Cloud (app.mem0.ai) |
| **Fact correction** | Superseding with audit trail | Overwrite (history lost) |
| **Extraction** | Zero LLM calls (rules-based) | LLM call on every write |
| **State management** | Checkpoints + branching | None |
| **Ecosystem** | Same DB works with AI SDK, LangChain, OpenClaw, inspector | Standalone API |
| **Graph memory** | Typed edges (free) | Pro plan required |

Both solve the same core problem. db0 is local-first and free. Mem0 is cloud-first with a managed API.

## Manage

```bash
npx @db0-ai/openclaw upgrade claude-code      # upgrade
npx @db0-ai/openclaw uninstall claude-code     # uninstall
```

## Documentation

- [Comparison with other Claude Code memory tools](docs/comparison.md)

## Part of db0

This MCP server is one entry point to the db0 SDK. The same memory database works with the [core SDK](../../core), [OpenClaw plugin](../openclaw), [CLI](../../cli), and [inspector](../../inspector).

## License

MIT
