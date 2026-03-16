# db0 — Memory Plugin for OpenClaw

> **Hosted skill**: Tell your OpenClaw agent: "Read https://db0.ai/skills/openclaw/SKILL.md and install db0"

## What is db0?

db0 is a ContextEngine plugin that gives OpenClaw agents persistent, scoped memory with automatic fact extraction. It replaces OpenClaw's default compaction-based memory with a proper memory system that extracts facts after every turn, not just when the context window overflows.

## Installation Instructions

Follow these steps exactly to install and configure db0 for OpenClaw.

### Step 1: Run the init command

```bash
npx @db0-ai/openclaw init
```

This will:
- Install the db0 extension into `~/.openclaw/extensions/db0/`
- Create the plugin manifest (`openclaw.plugin.json`)
- Update `~/.openclaw/openclaw.json` to activate db0 as the context engine
- Set up persistent SQLite storage at `~/.openclaw/db0.sqlite`

If OpenClaw is installed in a non-default location, use the `--dir` flag:

```bash
npx @db0-ai/openclaw init --dir /path/to/openclaw
```

Or set the `OPENCLAW_HOME` environment variable.

### Step 2: Restart OpenClaw

Restart OpenClaw so it picks up the new plugin configuration.

### Step 3: Verify

Tell the user that db0 is installed and configured. Their agent now has:

- **Persistent memory** stored at `~/.openclaw/db0.sqlite`
- **Automatic fact extraction** after every turn (preferences, decisions, task context)
- **Scoped memory** — user facts persist across sessions, task context stays within the current task
- **State checkpoints** — restorable execution state after every turn
- **Sub-agent support** — memory inheritance and result backflow between parent and child agents
- **Structured logging** — full audit trail of turns, extractions, and compaction events

### Manual Setup (alternative)

If the init command doesn't work, set up manually:

1. Create extension directory and install:
```bash
mkdir -p ~/.openclaw/extensions/db0
cd ~/.openclaw/extensions/db0
npm init -y
npm install @db0-ai/openclaw
```

2. Create `~/.openclaw/extensions/db0/index.js`:
```javascript
module.exports = async function register(api) {
  const { db0 } = await import("@db0-ai/openclaw");
  api.registerContextEngine("db0", () => db0());
};
```

3. Create `~/.openclaw/extensions/db0/openclaw.plugin.json`:
```json
{
  "id": "db0",
  "name": "db0 Context Engine",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
```

4. Add to `~/.openclaw/openclaw.json`:
```json
{
  "plugins": {
    "slots": {
      "memory": "none",
      "contextEngine": "db0"
    },
    "entries": {
      "db0": { "enabled": true }
    }
  }
}
```

5. Restart OpenClaw.

### Optional Upgrades

Edit `~/.openclaw/extensions/db0/index.js` to customize:

**Semantic search with real embeddings:**
```javascript
module.exports = async function register(api) {
  const { db0 } = await import("@db0-ai/openclaw");
  api.registerContextEngine("db0", () => db0({
    embeddingFn: async (text) => {
      // OpenAI, Ollama, transformers.js, etc.
    },
    minScore: 0.65,
  }));
};
```

**Cross-device sync with Postgres:**
```javascript
api.registerContextEngine("db0", () => db0({
  storage: "postgresql://user:pass@your-host/db0",
  embeddingFn: myEmbed,
  minScore: 0.65,
}));
```

**Manual extraction only (no auto-extract):**
```javascript
api.registerContextEngine("db0", () => db0({ extraction: "manual" }));
```

## How It Works

db0 implements OpenClaw's ContextEngine lifecycle:

| Hook | What db0 does |
|---|---|
| `bootstrap` | Opens SQLite, restores last checkpoint |
| `assemble` | Searches memory by similarity to current message, injects relevant context |
| `ingest` | Extracts facts from assistant response, logs turn, checkpoints state |
| `compact` | Extracts facts from messages about to be discarded (saves before compaction) |
| `afterTurn` | Logs turn completion |
| `prepareSubagentSpawn` | Selects relevant memories to pass to child agent |
| `onSubagentEnded` | Extracts facts from child agent results, backflows to parent memory |

### Memory Scopes

| Scope | Lifetime | Auto-detected signals |
|---|---|---|
| `user` | Permanent | "user prefers", "always use", "remember that", "don't like" |
| `session` | Current session | "decided to", "important:", "agreed to" |
| `task` | Current task | "working on", "current task", "next step", "todo" |

## Troubleshooting

- **Memory not persisting**: Check that `~/.openclaw/` directory exists and is writable
- **Plugin not loading**: Verify `~/.openclaw/openclaw.json` has `"contextEngine": "db0"` under `plugins.slots`, and restart OpenClaw
- **No memories being extracted**: The default `"rules"` extraction looks for signal words. If the assistant doesn't use them naturally, try `extraction: "manual"` and call `memory().write()` explicitly
- **Want to inspect the database**: The SQLite file at `~/.openclaw/db0.sqlite` can be opened with any SQLite viewer. Tables: `db0_memory`, `db0_state`, `db0_log`
- **Custom OpenClaw directory**: Use `npx @db0-ai/openclaw init --dir /your/path` or set `OPENCLAW_HOME`
