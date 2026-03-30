# @db0-ai/openclaw

Your OpenClaw agent forgets things it shouldn't. You told it your preferences three sessions ago — gone. A sub-agent spent 10 minutes researching — the parent never saw the results. You switched projects and yesterday's context bled into today's work.

db0 is a ContextEngine plugin that gives your agent memory that actually works — across sessions, between agents, and across projects.

## Quick Start

```bash
openclaw plugins install @db0-ai/openclaw
```

Or use the interactive installer for more options:

```bash
npx @db0-ai/openclaw init
```

Both set up persistent SQLite storage, configure `openclaw.json`, and activate db0 as the context engine. Restart OpenClaw to activate.

**Requires OpenClaw v2026.3.7 or later.** Compatible with v2026.3.22 (latest).

Or tell your OpenClaw agent:

> Read https://db0.ai/skills/openclaw/SKILL.md and install db0

## What You Get

Out of the box, zero configuration:

- **Your agent remembers** — preferences, decisions, and context persist across sessions
- **Facts stay current** — when things change, old facts are superseded, not duplicated
- **Projects stay separate** — scoped memory prevents cross-project contamination
- **Sub-agents collaborate** — parent and child share memory automatically
- **Nothing is lost to compaction** — facts are extracted before messages are discarded
- **You can see what it knows** — inspector UI, CLI, and structured logs for full visibility
- **Memory consolidation** — related facts are automatically clustered and merged over time (with `consolidateFn`)

## Memory Consolidation

When you provide a `consolidateFn`, db0 clusters semantically similar memories and merges them via your LLM. Three memories about TypeScript preferences become one concise fact. Runs as part of `reconcile()` — no extra calls needed.

```typescript
db0({
  consolidateFn: async (memories) => {
    const response = await callGemini(
      `Merge these related facts into one concise statement:\n${memories.map(m => m.content).join("\n")}`
    );
    return { content: response.text };
  }
})
```

Without `consolidateFn`, reconcile only does exact-match dedup — same as before, zero LLM calls.

## Upgrade Embeddings

Works out of the box with hash embeddings (exact/near-exact match). For semantic search, set one env var:

```bash
export GEMINI_API_KEY="your-key"    # free tier, auto-detected
```

Or use local embeddings:

```bash
ollama pull nomic-embed-text
npx @db0-ai/openclaw set embeddings ollama
```

| Provider | Setup | Quality | Cost |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY` env var | Good (768d) | Free tier |
| `ollama` | `ollama pull nomic-embed-text` | Good | Free (local) |
| `openai` | `OPENAI_API_KEY` env var | Best | ~$0.02/1M tokens |
| `hash` | Zero-config (default) | Exact match | Free |

When the provider changes, existing memories are re-embedded automatically.

## Inspector

```bash
npx @db0-ai/inspector
```

Opens a web UI at `http://127.0.0.1:6460` with three views:

- **Memories** — browse, filter, and search by scope, status, source, and extraction method
- **Dashboard** — charts showing memory distribution and confidence levels
- **Health** — integrity report surfacing contradictions, missing summaries, and orphaned edges

See [@db0-ai/inspector](../../inspector) for full options.

## CLI

```bash
npx @db0-ai/openclaw init                  # install
npx @db0-ai/openclaw upgrade               # upgrade to latest
npx @db0-ai/openclaw uninstall             # remove (--keep-data to preserve DB)
npx @db0-ai/openclaw set embeddings ollama  # switch embedding provider
npx @db0-ai/openclaw get                    # view current settings
npx @db0-ai/openclaw status                 # check health
npx @db0-ai/openclaw restore               # restore from Postgres backup
```

## How It Works

```
User message
  │
  ▼
┌─────────────┐
│  assemble() │ ← search memory, inject relevant context
└──────┬──────┘
       │
       ▼
   LLM call
       │
       ▼
┌─────────────┐
│   ingest()  │ ← extract facts, log turn, checkpoint state
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ afterTurn() │ ← preserve compaction summaries
└─────────────┘
```

| Lifecycle | What db0 does |
|---|---|
| **bootstrap** | Open storage, restore checkpoint, sync memory index, run backup |
| **assemble** | Search structured facts + file chunks, inject context |
| **ingest** | Extract facts from messages, log turn, checkpoint state |
| **compact** | Extract facts from messages about to be discarded, snapshot memory files |
| **afterTurn** | Preserve compaction summaries as durable memory |
| **prepareSubagentSpawn** | Spawn child harness with shared backend, build briefing |
| **onSubagentEnded** | Store child's result, close child harness |
| **dispose** | Flush and close |

## Documentation

For detailed configuration, API reference, and advanced usage:

- [Configuration Reference](docs/configuration.md) — all options, storage backends, extraction strategies
- [Memory & Search](docs/memory.md) — scopes, superseding, hybrid search, relationships, structured content
- [Sub-Agents](docs/sub-agents.md) — shared backend model, visibility rules, lifecycle hooks
- [Embeddings](docs/embeddings.md) — provider setup (OpenAI, Ollama, transformers.js), custom functions
- [Migration](docs/migration.md) — importing from legacy OpenClaw MEMORY.md
- [Manual Setup](docs/manual-setup.md) — step-by-step without the CLI installer

## License

MIT
