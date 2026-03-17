# @db0-ai/openclaw

Your agent remembers what matters — even across sessions.

OpenClaw ContextEngine plugin for db0: scoped memory, semantic recall, execution state, structured logging, and sub-agent context management.

## Quick Start

```bash
openclaw plugins install @db0-ai/openclaw
```

One command. Installs db0 as a context engine, sets up persistent SQLite storage, and configures `openclaw.json`. Restart OpenClaw to activate. Works with hash embeddings out of the box — upgrade to semantic search anytime with `npx @db0-ai/openclaw set embeddings gemini`.

Alternatively, `npx @db0-ai/openclaw init` provides an interactive installer that walks you through embedding provider selection and configuration. Use whichever you prefer — both produce the same result.

**Requires OpenClaw v2026.3.7 or later.** The ContextEngine API (assemble, ingest, compact, afterTurn, sub-agent hooks) was introduced in that release. db0 will refuse to load on older versions to avoid config validation errors — upgrade OpenClaw first.

Or tell your OpenClaw agent:

> Read https://db0.ai/skills/openclaw/SKILL.md and install db0

## CLI Commands

Configure db0 without editing config files:

```bash
# Install db0 plugin
npx @db0-ai/openclaw init

# Upgrade to latest version
npx @db0-ai/openclaw upgrade

# Upgrade Claude Code MCP server
npx @db0-ai/openclaw upgrade claude-code

# Upgrade both OpenClaw and Claude Code
npx @db0-ai/openclaw upgrade all

# Uninstall (removes extension, config, and database)
npx @db0-ai/openclaw uninstall

# Uninstall but keep the database
npx @db0-ai/openclaw uninstall --keep-data

# Uninstall Claude Code MCP server
npx @db0-ai/openclaw uninstall claude-code

# Uninstall both
npx @db0-ai/openclaw uninstall all

# Set embedding provider (hash | ollama | openai | gemini)
npx @db0-ai/openclaw set embeddings ollama

# Set custom model
npx @db0-ai/openclaw set embeddings.model mxbai-embed-large

# Set custom Ollama endpoint (e.g. remote server)
npx @db0-ai/openclaw set embeddings.baseUrl http://192.168.1.100:11434

# View current settings
npx @db0-ai/openclaw get

# View specific setting
npx @db0-ai/openclaw get embeddings

# Check status and health
npx @db0-ai/openclaw status
```

### Embedding Providers

| Provider | Setup | Quality | Latency | Cost |
|---|---|---|---|---|
| `gemini` | Auto-detected if `GEMINI_API_KEY` set | Good semantic search (768d) | ~100ms/call | Free tier |
| `hash` | Zero-config (fallback) | Exact/near-exact match | Instant | Free |
| `ollama` | `ollama pull nomic-embed-text` | Good semantic search | ~50ms/call | Free |
| `openai` | Set `OPENAI_API_KEY` env var | Best semantic search | ~200ms/call | ~$0.02/1M tokens |

Gemini is auto-detected and used by default when `GEMINI_API_KEY` is available — no configuration needed. When the embedding provider changes, all existing memories are automatically re-embedded on next bootstrap.

### Backup & Restore

With a hosted Postgres backend, db0 automatically backs up workspace files on every session. If local data is lost:

```bash
# See what's available to restore
npx @db0-ai/openclaw restore --dry-run

# Restore workspace from backend
npx @db0-ai/openclaw restore

# Force overwrite existing files
npx @db0-ai/openclaw restore --force
```

### Inspector UI

Browse, search, and manage your agent's memories in a web UI:

```bash
npx @db0-ai/inspector
```

Opens at `http://127.0.0.1:6460`. Auto-detects your `db0.sqlite` from `~/.openclaw/`.

The inspector has three views:

- **Memories** — browse and filter by scope, status, source, extraction method. Semantic search, confidence badges, detail modal with version history and relationships.
- **Dashboard** — charts showing memory distribution by scope, extraction method, source type, and confidence.
- **Health** — integrity report surfacing contradiction candidates, missing summaries, and orphaned edges.

Options:

```bash
# Custom database path
npx @db0-ai/inspector --db /path/to/db0.sqlite

# Custom port
npx @db0-ai/inspector --port 8080

# Specific agent
npx @db0-ai/inspector --agent my-agent
```

See [@db0-ai/inspector](../../inspector) for full documentation.

### Recommended Configuration

For most users, db0 works out of the box with zero config. If you want semantic search (instead of exact-match hash embeddings), set one environment variable:

```bash
# Free semantic embeddings via Google Gemini
export GEMINI_API_KEY="your-key"
```

That's it — db0 auto-detects the key and switches to Gemini embeddings. Alternatively:

```bash
# Local embeddings via Ollama (no API key needed)
ollama pull nomic-embed-text
npx @db0-ai/openclaw set embeddings ollama
```

### OpenClaw Session Reset

db0 preserves memory across sessions, but OpenClaw's default session reset policy may discard conversation context too aggressively. If your sessions reset before db0 has time to extract facts, increase the idle timeout in `~/.openclaw/openclaw.json`:

```json
{
  "session": {
    "reset": {
      "mode": "idle",
      "idleMinutes": 10080
    }
  }
}
```

| Value | Duration |
|---|---|
| `1440` | 1 day |
| `10080` | 7 days (recommended starting point) |
| `43200` | 30 days |

This only affects when OpenClaw starts a *new* session — db0's extracted memories persist regardless of session resets.

## What You Get

Out of the box, with no further configuration:

- **Persistent memory** — stored in `~/.openclaw/db0.sqlite`, survives restarts
- **Auto-extraction** — signal words like "user prefers", "remember that", "decided to" are automatically captured
- **Scoped recall** — relevant memories are injected into context before each LLM call
- **Memory superseding** — when facts change, old memories are marked superseded, not deleted
- **Hybrid search** — combine semantic similarity with recency and popularity scoring
- **Structured content** — store strings or structured objects as memory content
- **State checkpoints & branching** — restorable execution state with branch/restore from any checkpoint
- **Memory relationships** — typed edges between memories (related, derived, contradicts, supports)
- **Sub-agent support** — shared backend with automatic memory inheritance and isolation
- **Noise filtering** — refusals, greetings, and process narration blocked before extraction
- **Fallback extraction** — substantial messages without signal words are captured as low-confidence memories (with explicit provenance) to reduce silent knowledge loss
- **L0 summaries** — auto-generated one-line summaries for token-efficient context assembly
- **Compaction safety net** — pre-compaction message ingestion + memory file snapshots with overwrite detection
- **Auto-compaction summary** — preserves context from OpenClaw truncation events as durable memory
- **Incremental backup** — workspace files snapshotted to backend on every session (with hosted Postgres)
- **Disaster recovery** — `db0-openclaw restore` rebuilds workspace from backend if local data is lost
- **Structured logging** — full audit trail of every turn, extraction, and compaction
- **Legacy migration** — `migrateFromOpenClaw()` imports MEMORY.md and daily logs

## Upgrade Path

```typescript
// Default: persistent SQLite + hash embeddings + rules extraction
db0()

// Semantic search with real embeddings
db0({ embeddingFn: myEmbed, minScore: 0.65 })

// Cross-device sync via hosted Postgres (Neon, Supabase, etc.)
db0({ storage: "postgresql://...@your-host/db0", embeddingFn: myEmbed })
```

## Cross-Device Memory with Hosted Postgres

For memory that syncs across machines, use any hosted Postgres with pgvector (Neon, Supabase, Railway, etc.):

```bash
npm install @db0-ai/backends-postgres
```

```typescript
db0({
  storage: "postgresql://user:pass@your-host/db0",
  embeddingFn: myEmbed,
  minScore: 0.65,
})
```

Your memories, state, and logs are now in the cloud. Any device with the same connection string shares the same agent memory.

## Agent-Native Features

### Memory Superseding

When facts change, supersede old memories instead of deleting them. The old memory is preserved for audit but excluded from search by default.

```typescript
const original = await harness.memory().write({
  content: "User prefers light mode",
  scope: "user",
  embedding: await myEmbed("User prefers light mode"),
});

// Later, the user changes their preference
const updated = await harness.memory().write({
  content: "User prefers dark mode",
  scope: "user",
  embedding: await myEmbed("User prefers dark mode"),
  supersedes: original.id, // marks original as "superseded"
});

// Search only returns active memories by default
const results = await harness.memory().search({
  embedding: await myEmbed("theme preference"),
  scope: "user",
});
// → [{ content: "User prefers dark mode", status: "active" }]

// Include history when needed
const withHistory = await harness.memory().search({
  embedding: await myEmbed("theme preference"),
  scope: "user",
  includeSuperseded: true,
});
// → both old and new
```

### Hybrid Search

Combine semantic similarity with structured filters and temporal scoring.

```typescript
// Filter by tags (AND — all must match)
await harness.memory().search({
  embedding: queryVec,
  tags: ["preference", "ui"],
  scope: "user",
});

// Filter by metadata
await harness.memory().search({
  embedding: queryVec,
  metadata: { source: "chat" },
  scope: "user",
});

// Filter by time
await harness.memory().search({
  embedding: queryVec,
  since: "2025-01-01T00:00:00Z",
  scope: "user",
});

// Filter-only (no embedding)
await harness.memory().search({
  tags: ["important"],
  scope: "user",
});

// Hybrid scoring: 70% similarity + 20% recency + 10% popularity
await harness.memory().search({
  embedding: queryVec,
  scoring: "hybrid",
  scope: "user",
});
```

### Structured Content

Store strings or structured objects as memory content.

```typescript
// Plain string (as before)
await harness.memory().write({
  content: "User prefers dark mode",
  scope: "user",
  embedding,
});

// Structured object
await harness.memory().write({
  content: { type: "preference", key: "theme", value: "dark", confidence: 0.95 },
  scope: "user",
  embedding,
});
```

### State Branching

Create branches from any checkpoint for parallel exploration or rollback.

```typescript
const state = harness.state();

const cp1 = await state.checkpoint({ step: 1, label: "before-decision" });
const cp2 = await state.checkpoint({ step: 2, label: "chose-path-a" });

// Later: branch from cp1 to explore an alternative
const branchCp = await state.branch(cp1.id, {
  step: 3,
  label: "chose-path-b",
});
// branchCp.parentCheckpointId === cp1.id

// Get any checkpoint by ID
const retrieved = await state.getCheckpoint(cp1.id);
```

### Memory Relationships

Add typed edges between memories to create a knowledge graph.

```typescript
const m1 = await harness.memory().write({ content: "TypeScript is preferred", scope: "user", embedding: e1 });
const m2 = await harness.memory().write({ content: "Use strict mode", scope: "user", embedding: e2 });
const m3 = await harness.memory().write({ content: "JavaScript is preferred", scope: "user", embedding: e3 });

// Create relationships
await harness.memory().addEdge({ sourceId: m1.id, targetId: m2.id, edgeType: "related" });
await harness.memory().addEdge({ sourceId: m1.id, targetId: m3.id, edgeType: "contradicts" });

// Query relationships
const edges = await harness.memory().getEdges(m1.id);
// → [{ edgeType: "related", targetId: m2.id }, { edgeType: "contradicts", targetId: m3.id }]
```

Edge types: `related`, `derived`, `contradicts`, `supports`, `supersedes` (auto-created on supersede).

## Sub-Agent Support

db0 implements OpenClaw 3.8's sub-agent lifecycle hooks using a **shared backend** model. Parent and child agents share the same database — no text copy-paste, no extraction gymnastics.

### How it works

When `prepareSubagentSpawn` is called, db0 creates a child harness via `harness.spawn()` that shares the parent's database:

```
Parent harness (agentId: "main", sessionId: "s1")
  │
  │  spawn({ agentId: "researcher", sessionId: "s2" })
  │
  ▼
Child harness (agentId: "researcher", sessionId: "s2")
  │
  └── Same backend, same userId, different session
```

**Memory isolation is automatic** — enforced by scope visibility rules, not configuration:

| Memory written by | Scope | Visible to parent? | Visible to child? | Why |
|---|---|---|---|---|
| Parent | `user` | Yes | **Yes** | Same `userId`, no session filter |
| Parent | `session` | Yes | No | Different `sessionId` |
| Parent | `task` | Yes | No | Different `sessionId` |
| Child | `user` | **Yes** | Yes | Same `userId`, shared DB |
| Child | `task` | No | Yes | Different `sessionId` |

Key points:
- **No config needed** — isolation comes from the scope model, not strategy flags
- **User-scoped facts flow both ways instantly** — if the child writes a user preference, the parent sees it immediately via the shared database
- **Task-scoped work stays private** — the child's scratch work doesn't leak to the parent
- **Result summary is stored on end** — `onSubagentEnded` writes the child's result as a session memory on the parent, tagged `subagent-result`

### `prepareSubagentSpawn`

Spawns a child harness and builds a context briefing with memories relevant to the child's task:

```typescript
const blocks = await engine.prepareSubagentSpawn({
  parentAgentId: "main",
  parentSessionId: "s1",
  childAgentId: "researcher",
  childSessionId: "s2",
  task: "Research TypeScript best practices",
  memoryBudget: 10, // max memories in briefing
});
// blocks[0].content → "## Inherited Context\nTask: Research TypeScript..."
```

### `onSubagentEnded`

Stores the child's result in the parent's session memory and closes the child harness:

```typescript
await engine.onSubagentEnded({
  parentAgentId: "main",
  parentSessionId: "s1",
  childAgentId: "researcher",
  childSessionId: "s2",
  result: "Found that the user prefers strict TypeScript with ESLint.",
});
// Result is now searchable in the parent's memory
```

## Embedding Functions

> **Recommended:** Use the CLI to configure embeddings — no code changes needed:
> ```bash
> npx @db0-ai/openclaw set embeddings ollama
> ```
> The code examples below are for advanced usage or non-OpenClaw integrations.

The built-in hash embeddings work for exact and near-exact recall with zero setup. For real semantic search, pass your own `embeddingFn`:

### OpenAI

```typescript
import OpenAI from "openai";
const openai = new OpenAI();

db0({
  embeddingFn: async (text) => {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return new Float32Array(res.data[0].embedding);
  },
  minScore: 0.65,
})
```

### Ollama (local)

```typescript
db0({
  embeddingFn: async (text) => {
    const res = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
    });
    const { embedding } = await res.json();
    return new Float32Array(embedding);
  },
  minScore: 0.65,
})
```

### transformers.js (fully local, no API)

```typescript
import { pipeline } from "@xenova/transformers";
const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

db0({
  embeddingFn: async (text) => {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return new Float32Array(output.data);
  },
  minScore: 0.65,
})
```

## Options

| Option | Default | Description |
|---|---|---|
| `storage` | `~/.openclaw/db0.sqlite` | File path, `"postgresql://..."`, `":memory:"`, or a `Db0Backend` instance |
| `embeddingFn` | built-in hash | `(text: string) => Promise<Float32Array>` |
| `extraction` | `"rules"` | `"rules"`, `"llm"`, or `"manual"` |
| `llm` | — | LLM extraction config (required when `extraction` is `"llm"`) |
| `userId` | auto-detected | Stable user identity for `user` scope isolation. Uses `DB0_USER_ID`/`OPENCLAW_USER_ID`, then OS username |
| `summarizeFn` | first-sentence | Custom summary function for L0 context tiering |
| `searchLimit` | `8` | Max memories per search |
| `minScore` | `0.4` | Cosine similarity threshold (raise to 0.65+ with real embeddings) |

## How It Works

```
User message
  │
  ▼
┌─────────────┐
│  assemble() │ ← searches memory, injects relevant context
└──────┬──────┘
       │
       ▼
   LLM call ──────── spawn sub-agent? ─── prepareSubagentSpawn()
       │                                         │
       ▼                                         ▼
┌─────────────┐                          child runs (shared DB)
│   ingest()  │                                  │
└──────┬──────┘                                  ▼
       │                                 onSubagentEnded()
       ▼                                  (store result summary)
┌─────────────┐
│ afterTurn() │
└─────────────┘
```

| Lifecycle | What db0 does |
|---|---|
| **bootstrap** | Opens storage, restores last checkpoint, syncs memory index, runs incremental backup |
| **assemble** | Dual-index search (structured facts + file chunks), injects relevant context |
| **ingest** | Extracts facts from user and assistant messages (with system message filtering), logs turn, checkpoints state |
| **compact** | Ingests all messages being discarded, snapshots memory files, detects destructive overwrites |
| **afterTurn** | Ingests auto-compaction summaries as durable memory, logs turn completion |
| **prepareSubagentSpawn** | Spawns child harness (shared backend), builds task-relevant briefing |
| **onSubagentEnded** | Stores child's result summary, closes child harness |
| **dispose** | Flushes and closes storage |

## Memory Scopes

| Scope | Lifetime | Example triggers |
|---|---|---|
| `user` | Permanent, cross-session | "user prefers", "always use", "remember that" |
| `session` | Current session | "decided to", "important:", "agreed to" |
| `task` | Current task | "working on", "current task", "next step" |
| `agent` | Permanent, all sessions | (manual writes only in v0.1) |

## L0 Context Tiering

Every memory gets an auto-generated one-line summary (L0) stored alongside the full content (L2). During `assemble()`, summaries are used for context injection — fitting more memories into the token budget.

```typescript
// Default: first-sentence extraction
const entry = await harness.memory().write({
  content: "User prefers dark mode. They find it easier on the eyes during long sessions.",
  scope: "user",
  embedding,
});
// entry.summary → "User prefers dark mode."

// Explicit summary
await harness.memory().write({
  content: "Long detailed memory...",
  scope: "user",
  embedding,
  summary: "Custom one-liner",
});

// Custom summarize function (e.g., LLM-powered)
db0({
  summarizeFn: async (content) => callLLM(`Summarize in one line: ${content}`),
})
```

## Legacy Migration

Import existing OpenClaw memories (MEMORY.md curated entries + daily `memory/YYYY-MM-DD.md` logs):

```typescript
import { migrateFromOpenClaw } from "@db0-ai/openclaw";

const result = await migrateFromOpenClaw({
  memoryDir: "~/.openclaw/memory",
  backend,
  agentId: "my-agent",
  embeddingFn: myEmbed,
  onProgress: (entry, i, total) => console.log(`${i}/${total}: ${entry.content}`),
});
// result → { imported: 42, skipped: 3, errors: [] }
```

MEMORY.md entries are imported as `user` scope. Daily log entries are imported as `session` scope with date tags.

## Manual Setup

If you'd rather not use the init CLI:

1. Create the extension directory:
```bash
mkdir -p ~/.openclaw/extensions/db0
cd ~/.openclaw/extensions/db0
npm init -y
npm install @db0-ai/openclaw
```

2. Create `~/.openclaw/extensions/db0/index.js`:
```javascript
module.exports = async function register(api) {
  const mod = await import("@db0-ai/openclaw");
  api.registerContextEngine("db0", () => mod.db0());
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

4. Update `~/.openclaw/openclaw.json`:
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

## Advanced: Direct Harness Access

For use cases beyond OpenClaw, import the core SDK directly:

```typescript
import { db0Core, createSqliteBackend } from "@db0-ai/openclaw";

const backend = await createSqliteBackend();
const parent = db0Core.harness({
  agentId: "main",
  sessionId: "session-1",
  userId: "user-1",
  backend,
});

// Spawn a child agent — shares the same database
const child = parent.spawn({
  agentId: "researcher",
  sessionId: "research-session-1",
});

// Child can read parent's user-scoped memories immediately
// Child's task-scoped memories are isolated by sessionId
await child.memory().write({
  content: "Found that the API uses REST",
  scope: "task", // only visible to child
  embedding: await myEmbed("Found that the API uses REST"),
});

await child.memory().write({
  content: "User prefers GraphQL over REST",
  scope: "user", // immediately visible to parent too
  embedding: await myEmbed("User prefers GraphQL over REST"),
});

// Supersede a memory when facts change
const oldMemory = await child.memory().write({
  content: "Deploy target is Heroku",
  scope: "user",
  embedding: await myEmbed("Deploy target is Heroku"),
});

await child.memory().write({
  content: "Deploy target is AWS",
  scope: "user",
  embedding: await myEmbed("Deploy target is AWS"),
  supersedes: oldMemory.id, // old memory marked as superseded
});

// Clean up — child.close() doesn't close the backend
child.close();
parent.close(); // only root closes the backend
```

## License

MIT
