# db0 — Product Design Document

**Status:** Draft v0.1
**Author:** Lightcone
**Last updated:** March 2026

---

## 1. Problem

### 1.1 The Abstraction Mismatch

Relational databases were designed around a single mental model: a stateless application makes a request, reads or writes some data, and returns a response. Schema is defined upfront, reflecting a known domain. Queries are deterministic: "give me rows where user_id = X."

AI agents don't fit this model in three fundamental ways:

**Schema-first vs. schema-emergent.** Traditional databases require you to decide the shape of your data before you write a single row. AI agents don't have a known domain. An agent's data needs are emergent — you cannot anticipate at design time what it will need to remember, what patterns will emerge across sessions, or what relationships will matter.

**Field lookup vs. semantic query.** Document stores (MongoDB, DynamoDB) solved the write problem: schema-less storage. But they didn't solve the query problem. An agent doesn't ask "give me the record with scope = user." It asks "what's relevant to what I'm doing right now?" That's intent matching, not field lookup.

**Stateless request vs. long-running process.** Databases assume the application is stateless between requests. Agents are stateful across sessions, long-running within sessions, and increasingly collaborative across agents. State isn't a cache TTL — it's a first-class primitive with branching, rollback, and recovery semantics.

### 1.2 The DIY Tax

The current de facto approach: Redis for session state, a vector database for semantic memory, Postgres for logs and history, and custom glue code to thread context between them.

This works. The problems are:

- The abstractions aren't reusable across projects
- Every team rebuilds the same patterns from scratch
- Failure modes are subtle and hard to reason about
- No principled answer to questions like: when should task memory become user memory? What gets preserved during context compaction? What does rollback mean?

### 1.3 Why Existing Memory Tools Don't Solve This

**mem0:** LLM-driven extraction on every turn. Treats the problem as "memory retrieval" — a tool agents call. Doesn't control context assembly. Hard dependency on LLM for basic function. One extraction strategy for all information types. No memory superseding — stale facts persist alongside current ones.

**Zep:** Temporal knowledge graph with automatic summarization. Strong on episodic and relationship memory. Requires its own server (Zep Cloud or self-hosted). Still memory-only — no state, log, or recovery primitives. No sub-agent support.

**LangMem:** Tightly coupled to LangGraph. LLM-driven extraction. Tool-based: agents explicitly call memory functions. Memory only, no state or log primitives.

**Letta (formerly MemGPT):** Full agent runtime with OS-inspired memory tiers. Agents self-edit their own memory blocks. Requires adopting Letta's runtime — not a library you embed into an existing harness.

The shared limitation: all of them treat memory as one problem, with one extraction strategy, controlling one layer (storage or retrieval). None of them control context assembly — what actually goes into the LLM's context window. None of them provide state branching, memory superseding, or sub-agent context sharing as first-class primitives.

### 1.4 OpenClaw Memory Pain Points (Research)

Research across OpenClaw's GitHub issues and community reveals five systemic pain points in the current memory architecture:

**Compaction destroys information.** Silent compaction failures delete hundreds of messages with a generic fallback instead of real summaries (#7477). Pre-compaction "write durable facts" instructions cause LLMs to overwrite MEMORY.md — one user lost 438 lines down to 8 (#38491). The safeguard compaction mode, shipped as the default, silently truncates context without warning.

**No structural understanding of facts.** Memory is flat text chunks — semantic search finds individual facts but cannot connect related ones. "Remembers everything but understands none of it." When a user says "Alice manages auth team" and later "auth team owns the login service," there is no way to connect these facts to answer "who handles login?"

**Fragile lifecycle hooks.** Memory flush is disabled by default; users don't realize info isn't being persisted (#41216). Session-end hooks don't trigger on archive/delete (#37027). No automated memory preservation mechanism exists (#40418).

**Cross-project contamination.** Facts from project A bleed into project B searches. No principled scope isolation between workspaces, agents, or tasks.

**QMD complexity for marginal gain.** QMD requires a separate CLI install, downloads GGUF models on first use, and can block for minutes on first search. When it fails, OpenClaw silently falls back to basic SQLite — users don't know which backend is active.

db0 addresses these directly:
- **Compaction safety net**: Before compaction, db0 ingests all messages being discarded and snapshots memory files. Overwrites are detectable and recoverable.
- **Knowledge graph**: db0's typed edges (related, contradicts, supports, derived) build structural relationships between facts. Graph traversal connects "Alice → manages → auth-team → owns → login-service."
- **Memory file versioning**: Every sync snapshots the current content hash. When MEMORY.md is overwritten by compaction, db0 detects the destructive change and can restore.
- **Scope isolation**: db0's four-level scope model (task/session/user/agent) with agentId scoping prevents cross-project contamination by design.
- **Zero-config simplicity**: No external sidecar, no model downloads, instant startup. sql.js WASM runs in-process.

---

## 2. Insight: Memory Is Four Different Problems

The core design insight of db0 is that "what to remember" is not a single question. It decomposes into four layers, each with different triggers, different retention policies, different query semantics, and different ownership:

| Layer | What it captures | Who decides | Trigger | Retention |
|---|---|---|---|---|
| **Durable facts** | User preferences, decisions, permanent context | Pluggable strategy | On ingest, lazily | Permanent, scope-bound |
| **Execution state** | Checkpoints, step progress, branching | Agent, explicitly | On checkpoint call | Session → recoverable |
| **Episodic context** | Recent conversation turns | Automatic | Every message | Token-budget window |
| **Consolidated knowledge** | Cross-session patterns, promoted facts | Async background | Post-session | Promoted to durable |

Collapsing these four layers into a single "memory" abstraction — as all existing tools do — forces bad tradeoffs across all of them. db0 treats each layer as a distinct primitive with its own API surface, retention semantics, and query behavior.

---

## 3. What db0 Is

db0 is an **agent-native storage engine** — the RocksDB for agent workloads.

RocksDB provides a tunable key-value engine that databases build on top of. It doesn't replace MySQL or Postgres — it provides the storage primitives that make them possible, with knobs for different workloads (write-heavy, read-heavy, point lookups, range scans).

db0 does the same for agent data. Today it's an SDK on top of existing storage backends (SQLite, PostgreSQL). In the future, it may include its own purpose-built storage engine. But the value is in the **agent-native primitives** and the **tunable architecture**, not the storage layer.

### 3.1 Core Value Proposition

1. **Agent-native primitives** — memory with scoping, superseding, and relationships; execution state with checkpoints and branching; structured logging; sub-agent context sharing. These are the building blocks every agent needs but no database provides natively.

2. **Workload-tunable profiles** — like `postgresql.conf` templates, db0 provides named profiles (`conversational`, `knowledge-base`, `coding-assistant`, `agent-context`, `curated-memory`) that bundle dozens of knobs into sensible defaults. Each app tunes its own profile for its workload. Benchmarked: the right profile can swing performance by 40+ percentage points.

3. **Pluggable at every layer** — extraction strategy (rules/LLM/manual), embedding provider (Gemini/OpenAI/Ollama/hash), storage backend (SQLite/Postgres), scoring mode (similarity/hybrid/RRF), enrichment (augment/rewrite), query expansion. Apps compose only the capabilities they need.

4. **Apps, not plugins** — db0 is the platform. Apps (`@db0-ai/openclaw`, `@db0-ai/claude-code`, chatbot-memory) are complete applications built on db0, each with its own profile, ingestion pipeline, and context assembly strategy.

### 3.2 The Tuning Analogy

| RocksDB knob | db0 knob | What it controls |
|---|---|---|
| `write_buffer_size` | `ingest.chunkSize` | Granularity of stored data |
| `bloom_filter_bits` | `retrieval.minScore` | Precision/recall trade-off |
| `compaction_style` | `reconciliation.*` | Background maintenance strategy |
| `block_cache_size` | `retrieval.topK` | How much data is served per query |
| `compression_type` | `ingest.enrich` | Storage cost vs query quality |
| `max_write_buffer_number` | `extraction.batchInterval` | Buffering before flush |

Different workloads need different settings:
- **Chat agents** need fast decay and high recency weight (conversations go stale)
- **Knowledge bases** need enrichment and query expansion (documents are dense)
- **Code assistants** need high precision and long decay (code knowledge persists)
- **Curated memory** needs near-zero decay and manual extraction (facts are permanent)

### 3.3 What db0 Does Not Do

- Replace your database (today it sits above SQLite/Postgres; tomorrow it may include its own engine)
- Require a specific storage backend
- Require an LLM to function
- Require external API calls for embeddings (built-in hash embeddings work out of the box)
- Force a single extraction strategy or ingestion pipeline

---

## 4. Architecture

### 4.1 Layers

```
┌──────────────────────────────────────────────────────┐
│                    Apps Layer                         │
│  @db0-ai/openclaw    @db0-ai/claude-code   chatbot   │
│  (profile:           (profile:             (profile:  │
│   agent-context)      curated-memory)       convo)    │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│              db0 Engine (core SDK)                    │
│                                                      │
│  Profiles ─── tunable knobs per workload             │
│  ├── ingest:  session | chunk | turn-context         │
│  │            enrich (augment | rewrite)              │
│  │            latent bridging                        │
│  ├── retrieval: hybrid scoring, query expansion,     │
│  │              graph traversal, configurable decay  │
│  ├── extraction: rules | LLM | manual | batch       │
│  └── reconciliation: background maintenance          │
│                                                      │
│  Primitives                                          │
│  ├── memory()   ← scoped, superseding, graph edges  │
│  ├── state()    ← checkpoints, branching             │
│  ├── log()      ← structured trace                   │
│  └── spawn()    ← sub-agent context sharing          │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│              Backend Interface                        │
├────────────────┬─────────────────────────────────────┤
│  SQLite        │  PostgreSQL + pgvector              │
│  (sql.js WASM) │  (hosted: Neon, Supabase, etc.)    │
├────────────────┴─────────────────────────────────────┤
│  Future: purpose-built agent-native storage engine   │
└──────────────────────────────────────────────────────┘
```

### 4.2 The Harness

The `Harness` is the core unit of db0. It is scoped to a single `(agentId, sessionId)` pair. All component calls carry this scope implicitly.

```typescript
const harness = db0.harness({
  agentId: "main",
  sessionId: "session-abc",
  userId: "user-123",       // optional, for cross-session user scope
  backend,
  extraction: {             // optional, defaults to "rules"
    durableFacts: "rules",  // "rules" | "llm" | "manual"
  }
})
```

### 4.3 Sub-Agent Support

Parent agents can spawn child harnesses that share the same database backend:

```typescript
const child = harness.spawn({
  agentId: "researcher",
  sessionId: "research-session-1",
})
// child.userId inherited from parent
// child shares the same backend — no copy, no extraction
// child.close() does NOT close the backend; only root does
```

Memory isolation is automatic via scope visibility rules:

| Memory written by | Scope | Visible to parent? | Visible to child? | Why |
|---|---|---|---|---|
| Parent | `user` | Yes | **Yes** | Same `userId`, shared DB |
| Parent | `session` | Yes | No | Different `sessionId` |
| Child | `user` | **Yes** | Yes | Same `userId`, shared DB |
| Child | `task` | No | Yes | Different `sessionId` |

### 4.4 Components

#### memory()

Scoped, semantic, persistent memory store with superseding, hybrid search, and typed relationships.

```typescript
// Write — supports string or structured content
await harness.memory().write({
  content: "User prefers TypeScript over Python",
  scope: "user",            // task | session | user | agent
  embedding: float32Array,
  tags: ["preference", "language"],
})

// Write structured content
await harness.memory().write({
  content: { type: "preference", key: "language", value: "TypeScript", confidence: 0.95 },
  scope: "user",
  embedding: float32Array,
})

// Supersede — marks old memory as superseded, creates audit trail
await harness.memory().write({
  content: "User prefers Rust over TypeScript",
  scope: "user",
  embedding: float32Array,
  supersedes: oldMemoryId,  // old entry status → "superseded"
})

// Hybrid search — semantic + structured filters + temporal scoring
await harness.memory().search({
  embedding: queryVec,        // optional — omit for filter-only search
  scope: ["user", "agent"],   // scope is a first-class filter
  limit: 8,
  minScore: 0.65,
  tags: ["preference"],       // AND filter — all must match
  since: "2025-01-01T00:00:00Z",
  metadata: { source: "chat" },
  scoring: "hybrid",          // similarity * 0.7 + recency * 0.2 + popularity * 0.1
  includeSuperseded: false,   // default: only active memories
})

// Typed relationships between memories
await harness.memory().addEdge({
  sourceId: mem1.id,
  targetId: mem2.id,
  edgeType: "contradicts",    // related | derived | contradicts | supports | supersedes
})
const edges = await harness.memory().getEdges(mem1.id)

// List, get, delete
await harness.memory().list(scope?)
await harness.memory().get(id)
await harness.memory().delete(id)
```

**Scope semantics:**

| Scope | Lifetime | Visibility |
|---|---|---|
| `task` | Current task | This agent, this session |
| `session` | Current session | This agent |
| `user` | Permanent | All sessions for this userId |
| `agent` | Permanent | All sessions for this agentId |

Scope is enforced at write time. `task` and `session` scoped memories carry `sessionId`; `user` and `agent` scoped memories do not.

**Memory status:**

| Status | Meaning | Included in search? |
|---|---|---|
| `active` | Current, valid memory | Yes (default) |
| `superseded` | Replaced by a newer memory | Only with `includeSuperseded: true` |

#### state()

Execution checkpoints with restore and branching semantics.

```typescript
await harness.state().checkpoint({
  step: 3,
  label: "after-tool-call",
  metadata: { toolName, result, tokenCount },
})

const last = await harness.state().restore()
// → StateCheckpoint | null

// Branch from any checkpoint to explore alternatives
const branch = await harness.state().branch(checkpointId, {
  step: 4,
  label: "alternative-path",
})
// branch.parentCheckpointId === checkpointId

// Get any checkpoint by ID
const cp = await harness.state().getCheckpoint(id)
```

State is not a cache. It is a recoverable execution record. The distinction matters: caches are invalidated, checkpoints are restored. Branching enables parallel exploration — an agent can branch from a decision point, try both paths, and compare outcomes.

#### log()

Structured event stream. Full fidelity, no extraction.

```typescript
await harness.log().append({
  event: "turn.start",
  level: "info",
  data: { messageCount, tokenEstimate },
})

await harness.log().query(limit?)
```

Every message, every tool call, every compaction event goes to the log. The log is the source of truth for debugging and audit. It does not participate in memory retrieval.

#### tools() — v0.2

Tool result caching and invocation logging. Prevents redundant tool calls, which are a significant source of agent cost and errors.

#### safety() — v0.2

Pre-action guardrail evaluation with automatic audit logging.

#### recovery() — v0.3

Explicit rollback markers before risky operations.

---

## 5. Extraction Strategy

### 5.1 Design Principle

Extraction strategy is a harness configuration, not a storage primitive. The backend receives `memory.write()` calls — it doesn't know or care how extraction decisions were made.

### 5.2 Available Strategies (v0.1)

**`"rules"` (default)**
Signal-word matching over assistant message content. Zero LLM calls, deterministic, near-zero latency. Suitable for high-frequency agents where extraction cost matters.

```typescript
// Detects sentences containing signals like:
// "user prefer*", "always use*", "remember", "important:"
// "working on", "current task", "next step*", "decided to"
```

**`"manual"`**
No automatic extraction. Agent calls `harness.memory().write()` explicitly. Full control, no surprises.

**`"llm"`**
LLM-driven extraction via configurable prompt. Higher precision, latency and cost tradeoff. Requires `llm` config with `extractFn`.

### 5.3 Noise Filtering

Before extraction (both rules and LLM), db0 filters out noise — refusals, greetings, meta-questions, and process narration. This prevents low-signal content from polluting durable memory. The filter is always active and requires no configuration.

### 5.4 L0 Summaries (Context Tiering)

Every memory entry has an auto-generated one-line summary (L0) stored alongside the full content (L2). During context assembly, summaries are used instead of full content to fit more memories into the token budget.

- Default: first-sentence extraction with 120-char truncation fallback (`defaultSummarize`)
- Custom: provide `summarizeFn` in harness config (e.g., LLM-powered summarization)
- Explicit: pass `summary` in `memory().write()` to override auto-generation

### 5.5 Auto-Detected Embeddings

db0 auto-detects the best available embedding provider on startup:

| Provider | Detection | Dimensions | Cost |
|---|---|---|---|
| **Gemini** | `GEMINI_API_KEY` env var | 768 | Free tier (batch: 100/request) |
| **Ollama** | CLI-configured | varies | Free (local) |
| **OpenAI** | `OPENAI_API_KEY` env var | 1536 | ~$0.02/1M tokens (batch: 2048/request) |
| **Hash** | Always available (fallback) | 384 | Free, zero API calls |

When the embedding provider changes (e.g., user adds a Gemini API key), all existing memories are automatically re-embedded on next bootstrap. Batch embedding APIs are used where available (Gemini `batchEmbedContents`, OpenAI array input) for efficient bulk operations.

Built-in hash embeddings use trigram + unigram FNV-1a hashing (384 dimensions, L2 normalized). Zero API calls, zero configuration, instant. Effective for exact and near-exact recall.

### 5.6 Consolidation (v0.2)

Async background process that runs post-session:

1. List all `task`-scoped memories from the completed session
2. Identify entries with `accessCount >= threshold`
3. Promote to `user` scope, supersede the `task` copy
4. Optionally: run cross-session pattern detection (LLM, async)

This is how short-term context becomes long-term knowledge — not via real-time LLM extraction, but via observed access patterns over time.

---

## 6. Backend Interface

The `Db0Backend` interface is the only contract between the SDK and storage. Any storage system that implements it is a valid backend.

```typescript
interface Db0Backend {
  // Memory
  memoryWrite(agentId, sessionId, userId, opts): Promise<MemoryEntry>
  memorySearch(agentId, sessionId, userId, opts): Promise<MemorySearchResult[]>
  memoryList(agentId, scope?): Promise<MemoryEntry[]>
  memoryDelete(id): Promise<void>
  memoryGet(id): Promise<MemoryEntry | null>

  // Memory Edges (relationships)
  memoryAddEdge(opts): Promise<MemoryEdge>
  memoryGetEdges(memoryId): Promise<MemoryEdge[]>
  memoryDeleteEdge(edgeId): Promise<void>

  // State
  stateCheckpoint(agentId, sessionId, opts): Promise<StateCheckpoint>
  stateRestore(agentId, sessionId): Promise<StateCheckpoint | null>
  stateList(agentId, sessionId): Promise<StateCheckpoint[]>
  stateGetCheckpoint(id): Promise<StateCheckpoint | null>

  // Log
  logAppend(agentId, sessionId, opts): Promise<LogEntry>
  logQuery(agentId, sessionId?, limit?): Promise<LogEntry[]>

  close(): void
}
```

### 6.1 Backends

| Backend | Package | Status | Notes |
|---|---|---|---|
| sql.js | `@db0-ai/backends-sqlite` | ✅ v0.1 | Pure JS, no native deps, dev/demo/local |
| PostgreSQL + pgvector | `@db0-ai/backends-postgres` | ✅ v0.1 | Production, native hybrid search, cross-device sync |
| In-memory | `@db0-ai/backends-sqlite` | ✅ v0.1 | Tests, CI (`:memory:` option) |

### 6.2 Storage Semantics Pushdown

The semantic layer lives in the SDK. Storage is standard. However: where a semantic operation can be made significantly more efficient by pushing it into the storage layer, it is.

**Implemented pushdown:**
- **Hybrid vector + structured queries in PostgreSQL** — pgvector cosine similarity + SQL tag/metadata/time filters + temporal scoring in a single query. SQLite backend does the same filtering in JS after loading scope-matched rows.
- **Superseding** — `UPDATE status = 'superseded'` + `INSERT new` in a single backend call. Search filters by `status = 'active'` at the storage layer.
- **Memory edges** — stored as a separate table (`db0_memory_edges`) with FK constraints in Postgres (CASCADE delete) and manual cleanup in SQLite.

The rule: start with SDK-layer semantics. Push to storage when there is a concrete performance case.

---

## 7. Framework Integration

### 7.1 Design Goal

db0 integrates with agent frameworks by implementing their native extension points — not by wrapping them or requiring them to adopt db0's interface.

### 7.2 OpenClaw ContextEngine (v0.1)

OpenClaw PR #22201 introduced the `ContextEngine` plugin interface, allowing external plugins to control the full context lifecycle. db0 implements this interface, including the v3.8 sub-agent lifecycle hooks.

Key lifecycle methods:

| Method | When called | db0 behavior |
|---|---|---|
| `bootstrap()` | Session start | Initialize harness, restore last state checkpoint, sync memory file index, run incremental backup to backend |
| `assemble()` | Before every LLM call | Dual-index search (structured facts + file chunks), await sync readiness, inject relevant context |
| `ingest()` | After each turn | Extract durable facts from user and assistant messages (with system message filtering), append to log, checkpoint state |
| `afterTurn()` | Post-turn | Ingest auto-compaction summary as durable memory, log turn completion |
| `compact()` | Token overflow | **Ingest all messages being discarded** before truncation. Snapshot memory files. Detect and log destructive overwrites. |
| `prepareSubagentSpawn()` | Sub-agent creation | Spawn child harness (shared backend), build task-relevant briefing |
| `onSubagentEnded()` | Sub-agent completion | Store child's result as parent session memory, close child harness |
| `dispose()` | Session end | Flush, close harness |

Unlike the legacy compactor, db0 treats compaction as a preservation event — every message being discarded is ingested into durable memory before removal. Memory files are snapshotted so overwrites by the compaction prompt can be detected and rolled back.

The critical difference from memory-only integrations: `assemble()` controls what goes into the context window — not just what gets stored. db0 decides what memories are relevant to the current query, how they are formatted, and how they fit within the token budget. OpenClaw's default compaction is replaced entirely.

**Zero-config setup:**
```bash
npx @db0-ai/openclaw init
```

**Or manual configuration:**
```typescript
// openclaw.config.ts
import { db0 } from "@db0-ai/openclaw";

export default {
  plugins: {
    slots: {
      memory: "none",
      contextEngine: db0({
        storage: "~/.openclaw/db0.sqlite",  // or "postgresql://..." for cross-device
        // embeddingFn: myEmbed,            // optional, built-in hash embeddings by default
        // minScore: 0.65,                  // raise with real embeddings
      }),
    },
  },
};
```

### 7.3 Plugin Roadmap

| Framework | Package | Interface | Status |
|---|---|---|---|
| OpenClaw | `@db0-ai/openclaw` | ContextEngine (incl. sub-agent hooks) | ✅ v0.1 |
| Claude Code | `@db0-ai/claude-code` | MCP server + skills + hooks | ✅ v0.1 |
| LangChain | `@db0-ai/langchain` | Memory adapter | v0.3 |
| LangGraph | `@db0-ai/langgraph` | Store interface | v0.3 |
| Custom | `@db0-ai/core` | Direct harness API | Always |

---

## 8. Repository Structure

```
db0/
├── packages/
│   ├── core/                  # @db0-ai/core — types, harness, interfaces
│   ├── backends/
│   │   ├── sqlite/            # @db0-ai/backends-sqlite
│   │   └── postgres/          # @db0-ai/backends-postgres
│   ├── inspector/             # @db0-ai/inspector — web UI
│   ├── cli/                   # @db0-ai/cli — memory CLI
│   └── plugins/
│       ├── openclaw/          # @db0-ai/openclaw
│       └── claude-code/       # @db0-ai/claude-code
│
├── docs/
│   ├── db0-product-design.md  # This document
│   └── db0-messaging.md       # Marketing messaging
│
├── CLAUDE.md                  # Project notes for Claude Code
├── SKILL.md                   # Self-install instructions for Claude Code agents
├── LICENSE                    # MIT
└── package.json               # npm workspaces root
```

---

## 9. Roadmap

### v0.1 — Foundation + Agent-Native (current)

- `@db0-ai/core`: types, harness, memory + state + log components, sub-agent spawn
- `@db0-ai/backends-sqlite`: sql.js (zero native deps), in-memory option
- `@db0-ai/backends-postgres`: PostgreSQL + pgvector, native hybrid search
- `@db0-ai/openclaw`: full ContextEngine lifecycle + sub-agent hooks + CLI installer
- Agent-native memory: superseding, typed relationships, structured content, hybrid search with temporal scoring
- State branching: branch from any checkpoint, restore arbitrary checkpoints
- Auto-detected embeddings: Gemini (free) → Ollama (local) → OpenAI → hash (fallback)
- Batch embedding APIs: Gemini batchEmbedContents (100/batch), OpenAI array input (2048/batch)
- Automatic embedding migration: re-embeds all memories when provider changes
- Multi-tier extraction: rules (zero-cost) → file promotion → batch LLM → reconciliation
- L0/L2 context tiering: auto-generated summaries for token-efficient assembly
- Dual-index context assembly: merges structured facts + file-chunk search results
- Noise filtering: automatic pre-extraction rejection of refusals, greetings, process narration
- Optional reranking: `rerankFn` for post-retrieval reordering
- Background incremental backup: workspace files snapshotted to backend every session
- Disaster recovery: `db0-openclaw restore` rebuilds workspace from backend snapshots
- Auto-compaction summary ingestion: preserves context from OpenClaw truncation events
- Compaction safety net: pre-compaction message ingestion + memory file snapshots
- Memory file versioning with overwrite detection
- Knowledge graph relationship detection during memory sync
- `@db0-ai/inspector`: web UI for browsing memory, state, and logs
- `@db0-ai/cli`: `db0 list`, `search`, `stats`, `export`, `import`
- OpenClaw legacy migration: `migrateFromOpenClaw()` for MEMORY.md + daily logs
- Schema v4 with summary column
- `@db0-ai/claude-code`: MCP server (9 tools), skills (inspect, ingest), hooks
- 170+ tests, TypeScript only

### v0.2 — Production Hardening

- `@db0-ai/core`: tools component (result caching), safety component (guardrails)
- Consolidation: async background job, accessCount-driven promotion with superseding
- Python SDK: `db0-python`, independent repo, async-first, pydantic schemas
- Schema migration tooling for backend upgrades

### v0.3 — Recovery + Ecosystem

- `@db0-ai/core`: recovery component (rollback markers)
- `@db0-ai/langchain`: Memory adapter
- `@db0-ai/langgraph`: Store interface
- Cross-agent memory scoping (shared `agent` scope across harness instances)

### v1.0 — Mission Control

- db0 Cloud: hosted backend, zero-ops
- Mission Control dashboard: memory browser, trace viewer, relationship graph explorer, consolidation inspector

---

## 10. Open Questions

1. **Python SDK API parity.** Should the Python SDK mirror the TypeScript API exactly, or be designed Python-native (async generators, pydantic models, context managers)? Current lean: Python-native, even if it diverges from TS.

2. **Consolidation timing.** Post-session consolidation requires knowing when a session has "ended." For long-running agent daemons, there may be no clear session boundary. Need a time-based or activity-based trigger in addition to session lifecycle events.

3. **Edge traversal queries.** Current `memoryGetEdges()` returns direct edges only. For knowledge graph use cases, should db0 support multi-hop traversal (e.g., "find all memories contradicting memories related to this one")? Deferred until real usage patterns emerge.

4. **Hybrid scoring weights.** Current weights (similarity 0.7, recency 0.2, popularity 0.1) are reasonable defaults. Should these be configurable per search call or per harness? Leaning toward per-search configurability in v0.2.

---

## Appendix: Key Decisions Log

| Decision | Rationale |
|---|---|
| SDK layer, not new storage engine | Storage engines are not the problem. Semantic query layer is. Pushdown to storage only when there's a concrete perf case. |
| `@db0-ai/*` npm scope | `db0` was taken by unjs/db0. `@db0-ai` is clear and available. |
| Scope as first-class concept | task/session/user/agent are not tags — they determine lifetime, visibility, and consolidation behavior. |
| Extraction is pluggable, not fixed | mem0's LLM extraction is accurate but expensive. Manual extraction is cheap but requires agent cooperation. Both are valid strategies for different contexts. |
| Built-in hash embeddings | Zero-config DX matters. Hash-based embeddings (trigram FNV-1a, 384 dimensions) work for exact/near-exact recall without any API dependency. Real embeddings are a one-line upgrade. |
| Memory superseding over delete | Agents correct themselves. Deleting old facts loses audit trail. Superseding preserves history while keeping search results current. |
| Shared backend for sub-agents | Text-based backflow (copy facts between agents via extraction) is lossy and fragile. Shared DB with scope isolation is simpler, faster, and lossless. |
| State branching over linear checkpoints | Agents explore alternatives. Linear checkpoints force a single path. Branching from arbitrary checkpoints enables parallel exploration and rollback to decision points. |
| ContextEngine over memory plugin | Controlling `assemble()` is more powerful than controlling `memory_search()`. The former owns the context window; the latter is just one input to it. |
| TypeScript first, Python v0.2 | OpenClaw (primary use case) is TS. Splitting engineering bandwidth at v0.1 slows iteration. Python SDK should be Python-native, not a port. |
| MIT license | Maximizes adoption. Hosted db0 Cloud (v1.0) is the commercial layer. |
