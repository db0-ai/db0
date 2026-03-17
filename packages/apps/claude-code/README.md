# @db0-ai/claude-code

Claude Code's built-in memory is a flat CLAUDE.md file — great for static project rules, but it doesn't learn. It can't remember what you told it last session, can't search semantically, and can't correct outdated facts.

db0 gives Claude Code persistent, scoped memory as an MCP server. Your preferences, decisions, and context survive across sessions — no manual CLAUDE.md maintenance.

## Quick Start

```
claude mcp add --transport stdio db0 -- npx -y @db0-ai/claude-code
```

That's it. No signup, no API key. Ask Claude: "what db0 tools do you have?" to verify.

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

## What You Get

- **Claude remembers across sessions** — preferences, decisions, and context persist
- **Facts stay current** — when things change, old facts are superseded, not duplicated
- **Semantic search** — Claude finds relevant memories by meaning, not just keywords
- **Full visibility** — inspector UI, CLI, and structured logs show what Claude knows
- **Zero config** — works out of the box with built-in embeddings, no API keys needed

## Tools

| Tool | Description |
|---|---|
| `db0_memory_write` | Store a fact with scope, tags, and optional superseding |
| `db0_memory_search` | Semantic search with scope/tag filtering |
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

## How It Works

```
You: "remember I prefer dark mode"
→ db0_memory_write({ content: "User prefers dark mode", scope: "user" })

You: "actually I switched to light mode"
→ db0_memory_write({ content: "User prefers light mode", scope: "user", supersedes: "<old-id>" })
```

Old memories are preserved for audit but excluded from search. CLAUDE.md continues to work for static rules — db0 handles the dynamic knowledge that accumulates over time.

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
