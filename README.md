# db0

**The agent-native storage engine.**

db0 is an open-source storage engine purpose-built for AI agent workloads — like RocksDB for agents. Tunable profiles for different workloads (chat, knowledge retrieval, coding, curated memory), agent-native primitives (scoped memory, state branching, sub-agent sharing), and pluggable backends (SQLite local-first, PostgreSQL remote-friendly).

## Quick Start

```bash
# Install
npx @db0-ai/openclaw init

# Upgrade
npx @db0-ai/openclaw upgrade

# Uninstall
npx @db0-ai/openclaw uninstall
```

Or use the core SDK directly:

```typescript
import { db0 } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

const backend = await createSqliteBackend();
const harness = db0.harness({ agentId: "main", sessionId: "s1", userId: "user-1", backend });

// Scoped memory with hybrid search
await harness.memory().write({
  content: "User prefers TypeScript",
  scope: "user",
  embedding: await myEmbed("User prefers TypeScript"),
  tags: ["preference"],
});

const results = await harness.memory().search({
  embedding: await myEmbed("language preference"),
  scope: ["user", "agent"],
  scoring: "hybrid", // similarity * 0.7 + recency * 0.2 + popularity * 0.1
});

// Supersede stale facts (old memory preserved but excluded from search)
await harness.memory().write({
  content: "User prefers Rust",
  scope: "user",
  embedding: await myEmbed("User prefers Rust"),
  supersedes: results[0].id,
});

// State with branching
const cp = await harness.state().checkpoint({ step: 1, label: "before-decision" });
await harness.state().branch(cp.id, { step: 2, label: "alternative-path" });

// Sub-agent with shared memory
const child = harness.spawn({ agentId: "researcher", sessionId: "s2" });
// child shares the same DB — user-scoped facts flow both ways instantly

harness.close();
```

## What You Get

- **Scoped memory** — 4 scopes (task/session/user/agent) with automatic visibility rules
- **Memory superseding** — correct stale facts while preserving full audit trail
- **Hybrid search** — semantic similarity + recency + popularity scoring, tag/metadata/time filters, graph-augmented retrieval
- **Structured content** — store strings or structured objects
- **Memory relationships** — typed edges (related, derived, contradicts, supports, supersedes) with 1-hop graph expansion during search
- **Entity extraction** — automatic extraction of people, dates, and places from conversations for entity-aware retrieval
- **Temporal search** — `since`/`until` time-range filters for time-scoped memory queries
- **State branching** — checkpoint and branch from any point for parallel exploration
- **Sub-agent support** — `harness.spawn()` with shared backend and automatic scope isolation
- **Auto-detected embeddings** — Gemini (free tier, auto-detected) → Ollama (local) → OpenAI → hash fallback (zero API calls). Re-embeds automatically when provider changes
- **Noise filtering** — automatic rejection of refusals, greetings, and process narration before extraction
- **Backup & restore** — incremental workspace snapshots to backend on every session. `db0-openclaw restore` rebuilds from hosted Postgres if local data is lost
- **L0 summaries** — auto-generated one-line summaries for token-efficient context assembly (custom `summarizeFn` supported)
- **Optional reranking** — post-retrieval reordering via custom `rerankFn` (e.g., cross-encoder)
- **Pluggable extraction** — rules (zero-cost, deterministic), LLM (higher precision), or manual (full control)
- **Structured logging** — full audit trail of every turn, extraction, and compaction
- **CLI** — `db0 list`, `search`, `stats`, `export`, `import` for inspecting and managing memories
- **Inspector** — web UI for browsing agent memory, state, and logs

## Packages

| Package | Description |
|---|---|
| `@db0-ai/core` | Engine — types, harness, memory/state/log components, profiles, extraction |
| `@db0-ai/backends-sqlite` | SQLite backend via sql.js (zero native deps) |
| `@db0-ai/backends-postgres` | PostgreSQL + pgvector backend |
| `@db0-ai/openclaw` | App — OpenClaw ContextEngine with CLI installer and legacy migration |
| `@db0-ai/claude-code` | App — Claude Code MCP server, skills, hooks |
| `@db0-ai/inspector` | App — web UI for browsing memory, state, and logs |
| `@db0-ai/cli` | CLI for memory operations (list, search, stats, export, import) |
| `@db0-ai/benchmark` | Memory quality benchmarks — LoCoMo, recall, and feature tests |

## Backends

**SQLite** (default) — zero native dependencies, works everywhere. Great for local development, single-machine agents, and testing. Your data stays on your machine.

**PostgreSQL + pgvector** — production-grade with native hybrid vector search. Use any hosted Postgres (Neon, Supabase, Railway) for cross-device memory sync and disaster recovery. Workspace files are automatically backed up to the backend — lose your laptop, restore everything with one command.

```typescript
import { db0 } from "@db0-ai/openclaw";

// SQLite (default) — local-first, zero network calls
db0()

// PostgreSQL for cross-device sync + backup
db0({ storage: "postgresql://user:pass@your-host/db0" })
// Gemini embeddings auto-detected if GEMINI_API_KEY is set
```

## OpenClaw Integration

db0 implements OpenClaw's ContextEngine interface, controlling the full context lifecycle:

```
bootstrap → assemble → ingest → compact → afterTurn → dispose
                         ↕
              prepareSubagentSpawn → onSubagentEnded
```

See [packages/apps/openclaw/README.md](packages/apps/openclaw/README.md) for full documentation.

## Architecture

```
┌─────────────────────────────────┐
│       AI Agent Harness          │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│           db0 SDK               │
│                                 │
│  harness(agentId, sessionId)    │
│  ├── memory()  ← hybrid search, │
│  │               superseding,   │
│  │               L0 summaries,  │
│  │               reranking,     │
│  │               relationships  │
│  ├── state()   ← checkpoints,  │
│  │               branching      │
│  ├── log()     ← structured    │
│  └── spawn()   ← sub-agents   │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│       Backend Interface         │
├──────────┬──────────────────────┤
│  SQLite  │  PostgreSQL+pgvector │
└──────────┴──────────────────────┘
```

## License

MIT
