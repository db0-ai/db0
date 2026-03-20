<p align="center">
  <img src="docs/db0-logo.svg" alt="db0" width="120" />
</p>

<h1 align="center">db0</h1>

<p align="center">
  <strong>The data layer for AI agents.</strong><br/>
  Memory that evolves. State that recovers. Context that stays current.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/@db0-ai/core"><img src="https://img.shields.io/badge/npm-v0.2.0-orange" alt="npm v0.2.0"></a>
  <a href="https://github.com/db0-ai/db0"><img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript"></a>
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#core-concepts">Core Concepts</a> &middot;
  <a href="#comparison">Comparison</a> &middot;
  <a href="#faq">FAQ</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## The Problem

### Memory is more than a vector store

Vector databases give you `embed → store → search`. That's retrieval, not memory. Real agent memory needs to know that "user prefers TypeScript" should *replace* "user prefers Python," that a preference should persist across sessions while a scratch note should not, and that contradictions should be detected — not silently accumulated.

### Agents need primitives that databases don't have

Scoped visibility. Fact superseding with audit trail. State checkpointing with branching. Context assembly within a token budget. These are the building blocks every agent needs, but no database provides natively.

### Every team rebuilds the same layer

The result: every team building agents writes its own scoping logic, extraction pipeline, deduplication checks, and compaction safety nets on top of general-purpose storage. db0 is that layer — an SDK that encodes agent data semantics on top of SQLite or PostgreSQL, so you don't have to.

## Quick Start

```bash
npm install @db0-ai/core @db0-ai/backends-sqlite
```

**Write memory with scope** — user-scoped facts persist across all sessions:

```typescript
import { db0 } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

const backend = await createSqliteBackend();
const harness = db0.harness({ agentId: "main", sessionId: "s1", userId: "user-1", backend });

await harness.memory().write({
  content: "User prefers TypeScript",
  scope: "user",                              // visible in every future session
  embedding: await embed("User prefers TypeScript"),
});
```

**Supersede stale facts** — old fact preserved for audit, excluded from search:

```typescript
await harness.memory().write({
  content: "User now prefers Rust",
  scope: "user",
  embedding: await embed("User now prefers Rust"),
  supersedes: oldMemoryId,                    // marks the old entry as superseded
});
```

**Pack context for the LLM** — assemble relevant memories within a token budget:

```typescript
const ctx = await harness.context().pack("help with current task", { tokenBudget: 2000 });
// ctx.text → formatted markdown ready for the system prompt
```

**Branch execution state** — checkpoint and explore alternatives:

```typescript
const cp = await harness.state().checkpoint({ step: 1, label: "before-decision" });
await harness.state().branch(cp.id, { step: 2, label: "try-alternative" });
```

**Spawn sub-agents** — shared backend, automatic memory isolation:

```typescript
const child = harness.spawn({ agentId: "researcher", sessionId: "s2" });
// user-scoped facts flow both ways; session-scoped facts stay isolated
```

See [examples/chat-agent](examples/chat-agent) for a complete working example.

### Framework Integrations

**OpenClaw** — zero-config ContextEngine plugin:

```bash
npx @db0-ai/openclaw init
```

Persistent memory, automatic fact extraction, sub-agent support. See [packages/apps/openclaw](packages/apps/openclaw).

**Claude Code** — MCP server with skills and hooks. See [packages/apps/claude-code](packages/apps/claude-code).

**AI SDK** — memory middleware for the [Vercel AI SDK](https://ai-sdk.dev). Wraps any model with `wrapLanguageModel()`:

```typescript
import { wrapLanguageModel } from "ai";
import { createDb0 } from "@db0-ai/ai-sdk";

const memory = await createDb0();
const model = wrapLanguageModel({ model: yourModel, middleware: memory.middleware });
```

Works with any provider (Anthropic, OpenAI, Google). See [packages/integrations/ai-sdk](packages/integrations/ai-sdk).

**LangChain.js** — memory tools and chat history for LangChain agents:

```typescript
import { createDb0 } from "@db0-ai/langchain";

const memory = await createDb0();
const agent = createReactAgent({ llm, tools: [...memory.tools] });
```

Replaces deprecated `BufferMemory` with scoped, persistent memory. See [packages/integrations/langchain](packages/integrations/langchain).

**Pi** — memory extension for the [Pi coding agent](https://github.com/badlogic/pi-mono). See [packages/integrations/pi](packages/integrations/pi).

## Architecture

```
  ┌──────────────────────────────────────────────────────────┐
  │  Applications                                            │
  │                                                          │
  │  ┌──────────┐   ┌─────────────┐   ┌──────────────────┐  │
  │  │ OpenClaw │   │ Claude Code │   │    Your Agent    │  │
  │  └──────────┘   └─────────────┘   └──────────────────┘  │
  └──────────────────────────┬───────────────────────────────┘
                             │
  ┌──────────────────────────▼───────────────────────────────┐
  │  Integrations                                            │
  │                                                          │
  │  ┌──────────────┐  ┌────────────┐  ┌─────┐                │
  │  │   AI SDK     │  │ LangChain  │  │ Pi  │                │
  │  └──────────────┘  └────────────┘  └─────┘                │
  └──────────────────────────┬───────────────────────────────┘
                             │
  ┌──────────────────────────▼───────────────────────────────┐
  │  db0 Core                                                │
  │                                                          │
  │  ┌────────┐  ┌─────────┐  ┌───────┐  ┌─────┐  ┌──────┐ │
  │  │ Memory │  │ Context │  │ State │  │ Log │  │Spawn │ │
  │  └────────┘  └─────────┘  └───────┘  └─────┘  └──────┘ │
  │                                                          │
  │  ┌──────────┐  ┌────────────┐  ┌────────────┐           │
  │  │ Profiles │  │ Extraction │  │ Embeddings │           │
  │  └──────────┘  └────────────┘  └────────────┘           │
  └──────────────────────────┬───────────────────────────────┘
                             │
  ┌──────────────────────────▼───────────────────────────────┐
  │  Backend Interface                                       │
  │                                                          │
  │  ┌────────────────┐       ┌────────────────────────────┐ │
  │  │ SQLite (sql.js) │       │ PostgreSQL + pgvector     │ │
  │  └────────────────┘       └────────────────────────────┘ │
  └──────────────────────────────────────────────────────────┘
```

## Core Concepts

### Memory

| Feature | What it does |
|---|---|
| **4 scopes** | `task` (ephemeral) → `session` → `user` → `agent` (permanent), each with visibility rules |
| **Superseding** | Correct stale facts without losing history — old entries preserved but excluded from search |
| **Hybrid search** | Semantic similarity + recency + popularity, with scope/tag/metadata/time filters |
| **Typed relationships** | `related`, `derived`, `contradicts`, `supports`, `supersedes` edges with graph expansion |
| **Entity extraction** | Auto-extract people, dates, places for entity-aware retrieval |
| **Noise filtering** | Rejects refusals, greetings, and process narration before extraction |
| **L0 summaries** | Auto-generated one-line summaries for token-efficient context assembly |
| **Provenance** | Every fact tracks source type, extraction method, and confidence |

### Context

The context lifecycle — what goes into the LLM's context window and what gets preserved:

| Verb | What it does |
|---|---|
| **`ingest`** | Write a fact with deduplication, contradiction detection, and entity enrichment |
| **`pack`** | Assemble relevant memories into a token budget with relationship annotations |
| **`preserve`** | Batch-extract and batch-embed facts from conversation messages before compaction |
| **`reconcile`** | Background maintenance — promote high-access chunks, merge duplicates, clean stale edges |

### State

Checkpoint and branch execution state. Restore to any prior checkpoint. Branch from any point to explore alternatives in parallel. Not a cache — a recoverable execution record.

### Sub-Agents

`harness.spawn()` creates a child harness sharing the same database. User-scoped memories flow between parent and child automatically. Session-scoped memories stay isolated. Same DB, no extraction, no serialization.

### Extraction

| Strategy | Tradeoff |
|---|---|
| **Rules** (default) | Signal-word matching. Zero LLM calls, deterministic, near-zero latency |
| **LLM** | Higher precision via configurable prompt. Latency and cost tradeoff |
| **Manual** | You call `memory().write()`. Full control, no surprises |

### Embeddings

Auto-detected on startup — no configuration needed:

```
Gemini (GEMINI_API_KEY, free tier)
  → Ollama (local)
    → OpenAI (OPENAI_API_KEY)
      → Hash (built-in, zero API calls, always works)
```

When the provider changes, existing memories are re-embedded automatically.

### Profiles

Named config bundles tuned for different workloads:

| Profile | Best for | Key trait |
|---|---|---|
| **conversational** | Chat, support | Fast decay, high recency weight |
| **agent-context** | Agent harnesses | Balanced hybrid scoring, auto-reconcile |
| **knowledge-base** | RAG, document search | Enrichment, query expansion, latent bridging |
| **coding-assistant** | IDE tools | High precision, slow decay |
| **curated-memory** | Human-authored facts | Near-zero decay, manual extraction |
| **high-recall** | Benchmarks, research | Large topK, low threshold, 2-hop expansion |

The right profile can swing retrieval quality by 40+ points on benchmarks.

### Tooling

- **CLI** — `db0 list`, `search`, `stats`, `export`, `import`
- **Inspector** — web UI for browsing memory, state, and logs
- **Benchmarks** — LoCoMo, LongMemEval, and feature-level test suites

## Packages

| Package | Description |
|---|---|
| [`@db0-ai/core`](packages/core) | Types, harness, memory/state/log/context, profiles, extraction |
| [`@db0-ai/backends-sqlite`](packages/backends/sqlite) | SQLite via sql.js — zero native deps |
| [`@db0-ai/backends-postgres`](packages/backends/postgres) | PostgreSQL + pgvector |
| [`@db0-ai/ai-sdk`](packages/integrations/ai-sdk) | Memory middleware for the Vercel AI SDK |
| [`@db0-ai/langchain`](packages/integrations/langchain) | Memory tools and chat history for LangChain.js |
| [`@db0-ai/pi`](packages/integrations/pi) | Memory extension for the Pi coding agent |
| [`@db0-ai/openclaw`](packages/apps/openclaw) | OpenClaw ContextEngine plugin + CLI |
| [`@db0-ai/claude-code`](packages/apps/claude-code) | Claude Code MCP server + skills + hooks |
| [`@db0-ai/inspector`](packages/inspector) | Web UI for memory/state/log inspection |
| [`@db0-ai/cli`](packages/cli) | CLI for memory operations |
| [`@db0-ai/benchmark`](packages/benchmark) | Memory quality benchmarks |

## Backends

**SQLite** (default) — pure JS via sql.js. Zero native deps, works everywhere. Local-first, your data stays on your machine.

**PostgreSQL + pgvector** — native hybrid vector search. Any hosted Postgres (Neon, Supabase, Railway) for production, cross-device sync, and disaster recovery.

```typescript
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { createPostgresBackend } from "@db0-ai/backends-postgres";

// Local — zero config
const local = await createSqliteBackend();

// Production — swap one line
const prod = await createPostgresBackend("postgresql://user:pass@host/db0");
```

## Comparison

db0 occupies a different layer than most "memory" tools. It's an embeddable SDK that controls the full data lifecycle — not just storage or retrieval, but context assembly, state management, and sub-agent coordination.

| | db0 | [Mem0](https://github.com/mem0ai/mem0) | [Zep](https://github.com/getzep/zep) | [Letta](https://github.com/letta-ai/letta) |
|---|---|---|---|---|
| **What it is** | Embeddable SDK (library) | Memory API service | Memory server | Full agent runtime |
| **Deployment** | In-process, no sidecar | Cloud or self-hosted server | Cloud or self-hosted server | Self-hosted server |
| **Memory scoping** | 4 scopes with visibility rules | User/agent/session | User/session | Agent-level blocks |
| **Fact correction** | Superseding with audit trail | Overwrite | Overwrite | Self-editing memory blocks |
| **State management** | Checkpoints + branching | No | No | Managed by runtime |
| **Sub-agent memory** | Shared backend, automatic isolation | No | No | No |
| **Context assembly** | `context().pack()` with token budgets | No (retrieval only) | No (retrieval only) | Yes (owns the runtime) |
| **Extraction** | Pluggable: rules / LLM / manual | LLM-only | Automatic summarization | LLM self-editing |
| **LLM required** | No (rules + hash embeddings) | Yes | Yes | Yes |
| **Storage** | SQLite or Postgres (bring your own) | Managed | Managed or Postgres | Managed |
| **Framework lock-in** | None — plain TypeScript | None (API) | None (API) | Letta runtime |

**When to use what:**

- **db0** — You're building an agent and want memory, state, and context as an embedded library. You want control over extraction, scoring, and context assembly without running a separate service.
- **Mem0** — You want a managed memory API you can call from any language. You're okay with LLM-driven extraction on every write.
- **Zep** — You want a memory server with built-in temporal knowledge graphs and automatic summarization.
- **Letta** — You want a complete agent runtime where the agent manages its own memory. You're okay adopting Letta's execution model.

## FAQ

<details>
<summary><b>Why not just use a vector database directly?</b></summary>
<br>
A vector database gives you storage and similarity search. db0 gives you the agent-specific primitives on top: scoped visibility, fact superseding, hybrid scoring with recency decay, state branching, context assembly with token budgets, sub-agent sharing, and pluggable extraction. You'd build all of this yourself on top of a vector DB — db0 is that layer, already built and tested.
</details>

<details>
<summary><b>Does db0 require an LLM to work?</b></summary>
<br>
No. The default configuration uses rule-based extraction (signal-word matching) and built-in hash embeddings. Zero API calls, zero cost, works offline. Upgrade to LLM extraction or real embeddings when you need better precision — it's a config change, not a rewrite.
</details>

<details>
<summary><b>How is this different from LangChain Memory or LangGraph Store?</b></summary>
<br>
LangChain Memory and LangGraph Store are memory adapters within their respective frameworks. db0 is framework-agnostic and covers more ground: scoped memory with superseding, execution state with branching, context assembly with token budgets and contradiction detection, structured logging, and sub-agent context sharing. You can use db0 with LangChain, or without any framework.
</details>

<details>
<summary><b>What about scaling?</b></summary>
<br>
SQLite handles single-agent workloads with zero network overhead. For production, multi-agent, or cross-device scenarios, switch to PostgreSQL + pgvector — one line change. Any hosted Postgres works: Neon, Supabase, Railway, or your own.
</details>

<details>
<summary><b>Can I use this with Python?</b></summary>
<br>
Not yet. db0 is TypeScript-first. A Python SDK is planned — it will be Python-native (async, pydantic), not a port of the TypeScript API.
</details>

<details>
<summary><b>What's the license?</b></summary>
<br>
MIT. Fully open source, no commercial restrictions.
</details>

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
