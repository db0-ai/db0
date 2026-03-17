# @db0-ai/openclaw

OpenClaw's built-in memory is a flat file that gets silently truncated when the context window overflows. Facts vanish during compaction, there's no scoping between projects, and sub-agents can't share what they've learned.

db0 replaces that with a real memory system — scoped, versioned, and persistent. Facts are extracted every turn (not just at compaction), scoped so they don't leak across projects, and preserved with full audit trail when they're corrected. Sub-agents share memory through the same database instead of lossy text extraction.

## Install

```bash
npx @db0-ai/openclaw init
```

One command. Sets up persistent SQLite storage, configures `openclaw.json`, and activates db0 as the context engine. Restart OpenClaw to activate.

**Requires OpenClaw v2026.3.7 or later.**

Or tell your OpenClaw agent:

> Read https://db0.ai/skills/openclaw/SKILL.md and install db0

## What You Get

Out of the box, with no further configuration:

- **Persistent memory** stored in `~/.openclaw/db0.sqlite`
- **Automatic fact extraction** from every conversation turn
- **Scoped recall** — relevant memories injected into context before each LLM call
- **Memory superseding** — stale facts corrected, not deleted
- **Sub-agent support** — shared memory with automatic isolation
- **State checkpoints** — restorable execution state with branching
- **Compaction safety** — facts extracted from messages before they're discarded
- **Structured logging** — full audit trail of turns, extractions, and compaction

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

## Inspect Your Memory

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
