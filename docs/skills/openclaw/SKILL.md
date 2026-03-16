# Install db0 for OpenClaw

You are an AI agent. Follow these instructions exactly to install db0 — a persistent memory plugin for OpenClaw.

## What you are installing

db0 replaces OpenClaw's default compaction-based memory with a proper memory system that:
- Extracts facts after every turn (not just when context overflows)
- Persists memories in SQLite across sessions
- Scopes memories (user/session/task) so the right context surfaces at the right time
- Supports sub-agent memory inheritance

## Step 1: Run the init command

Run this command in the terminal:

```bash
npx @db0-ai/openclaw init
```

This will:
- Install the db0 extension into `~/.openclaw/extensions/db0/`
- Create the plugin manifest (`openclaw.plugin.json`)
- Update `~/.openclaw/openclaw.json` to activate db0 as the context engine
- Set up persistent SQLite storage at `~/.openclaw/db0.sqlite`

If the user's OpenClaw is installed in a non-default location, ask them for the path and use:

```bash
npx @db0-ai/openclaw init --dir /path/to/openclaw
```

Or they can set the `OPENCLAW_HOME` environment variable.

## Step 2: Restart OpenClaw

Tell the user to restart OpenClaw so it picks up the new plugin configuration.

## Step 3: Confirm to the user

Tell the user that db0 is installed and configured. Their agent now has:

- **Persistent memory** stored at `~/.openclaw/db0.sqlite`
- **Automatic fact extraction** after every turn (preferences, decisions, task context)
- **Scoped memory** — user facts persist across sessions, task context stays within the current task
- **State checkpoints** — restorable execution state after every turn
- **Sub-agent support** — memory inheritance and result backflow between parent and child agents
- **Structured logging** — full audit trail of turns, extractions, and compaction events

## Fallback: Manual Setup

If the init command fails, set up manually:

1. Create the extension directory and install the package:
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

5. Tell the user to restart OpenClaw.

## Optional Upgrades

After installation, the user can edit `~/.openclaw/extensions/db0/index.js` to customize:

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

## Troubleshooting

- **Memory not persisting**: Check that `~/.openclaw/` directory exists and is writable
- **Plugin not loading**: Verify `~/.openclaw/openclaw.json` has `"contextEngine": "db0"` under `plugins.slots`, and restart OpenClaw
- **Custom OpenClaw directory**: Use `npx @db0-ai/openclaw init --dir /your/path` or set `OPENCLAW_HOME`

## Learn More

- GitHub: https://github.com/db0-ai/db0
- Docs: https://db0.ai
