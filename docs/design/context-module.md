# Design: Core `context()` Module

**Status:** Approved
**Date:** 2026-03-13
**Scope:** `packages/core/src/components/context.ts`

## Problem

db0 positions itself as an "agent-native" storage engine. Today it has strong
primitives for memory (write/search/edges), state (checkpoints), and logs —
but the context lifecycle that every AI agent needs (ingest facts, pack context
for the model, preserve knowledge before compaction, reconcile over time) lives
entirely in the apps layer (`packages/apps/openclaw/src/context-engine.ts`).

This means:
1. Any new integration (LangChain, CrewAI, custom agent) must reimplement
   ~500 lines of dedup, contradiction detection, entity enrichment, budget-aware
   packing, and reconciliation.
2. The core SDK has no opinion about embeddings — callers must bring their own
   and thread them through every call.
3. There's no standard way to detect or handle embedding provider changes.

## Research That Informed This Design

### LangChain Deep Agents Harness
- Context management should be automatic, not opt-in
- Auto-offloads context at 85% capacity threshold
- Context is a first-class concern, not bolted on

### Letta / MemGPT
- "Memory IS context" — what's pinned to the system prompt is "core memory"
- Memory has a budget; the system manages what fits

### Anthropic (Building Effective Agents)
- Keep agent architectures simple
- Optimize the augmented LLM (retrieval + tools + memory) as the core building block

## Design

### Principle: One Primitive, Four Verbs

Rather than creating multiple modules, we add a single `context()` primitive
to the Harness with four methods that map to the agent context lifecycle:

```
ingest  → per-fact write with quality (dedup + contradiction + entities)
pack    → assemble context for the model within a token budget
preserve → batch extract + batch embed + write all facts (pre-compaction)
reconcile → promote, merge, clean (background maintenance)
```

This mirrors how the existing context-engine works, but as reusable core
primitives rather than app-specific code.

### Why a Single Class, Not Separate Modules

1. **All four operations share state**: the embedding function, the harness
   (memory/edges), and the profile settings. Splitting into 4 modules would
   require passing the same dependencies to each.
2. **The operations form a lifecycle**: ingest → pack → preserve → reconcile
   is a natural progression. A single class makes the lifecycle legible.
3. **Simpler API surface**: `harness.context().pack(query)` vs importing and
   wiring 4 separate modules.

### API Surface

```typescript
class Context {
  constructor(harness: Harness, embeddingFn: EmbeddingFn, batchEmbeddingFn: BatchEmbeddingFn, profile: Db0Profile)

  // Write a single fact with dedup, contradiction detection, entity enrichment
  async ingest(content: string, opts: ContextIngestOpts): Promise<ContextIngestResult>

  // Assemble relevant context for a query within a token budget
  async pack(query: string, opts?: ContextPackOpts): Promise<ContextPackResult>

  // Batch-extract and batch-embed facts from conversation messages (pre-compaction)
  async preserve(messages: PreserveMessage[], opts?: ContextPreserveOpts): Promise<ContextPreserveResult>

  // Background maintenance: promote high-access chunks, merge dupes, clean edges
  async reconcile(opts?: ContextReconcileOpts): Promise<ContextReconcileResult>
}
```

### Embedding in Core

The core needs to know about embeddings without depending on specific providers.
We add two function types to `HarnessConfig`:

```typescript
type EmbeddingFn = (text: string) => Promise<Float32Array>;
type BatchEmbeddingFn = (texts: string[]) => Promise<Float32Array[]>;

interface HarnessConfig {
  // ... existing fields ...
  embeddingFn?: EmbeddingFn;
  batchEmbeddingFn?: BatchEmbeddingFn;
}
```

- If `embeddingFn` is not provided, `context()` falls back to `hashEmbed`
  (the existing zero-dependency hash embedding).
- If `batchEmbeddingFn` is not provided, it wraps `embeddingFn` sequentially.
- Provider-specific implementations (Gemini, OpenAI, Ollama) stay in the apps
  layer — core only knows the function signatures.

### Batch Embedding Strategy (Engineering Practice)

Batch embedding is critical for `preserve()`, which processes many facts at once.

**Pipeline for `preserve()`:**
1. Extract facts from all messages (CPU-only, fast — no API calls)
2. Collect all fact content strings into a single array
3. Batch-embed all at once using `batchEmbeddingFn`
4. For each fact: search for near-duplicates using pre-computed embedding,
   check contradiction, write

**Provider batch sizes** (managed in apps layer, transparent to core):
- Gemini: 100/request with retry + backoff
- OpenAI: 2048/request (native array input)
- Ollama: sequential (no batch API)
- Hash: instant (in-process computation)

Core's `BatchEmbeddingFn` is provider-agnostic — it just accepts `string[]`
and returns `Float32Array[]`. The apps layer handles chunking into
provider-specific batch sizes.

### Profile Integration

Add a `context` section to `Db0Profile` for tuning context behavior:

```typescript
interface Db0Profile {
  // ... existing sections ...
  context?: {
    /** Token budget ratio for packed context (0.0-1.0 of model context window). Default: 0.15 */
    budgetRatio?: number;
    /** Include relationship edges in packed output. Default: true */
    includeEdges?: boolean;
    /** Max items in pack() result. Default: profile's retrieval.topK */
    maxPackItems?: number;
  };
}
```

This is intentionally minimal — most behavior inherits from the existing
`retrieval` and `extraction` profile sections. Only context-specific knobs
get a new section.

### Embedding Migration

Rather than auto-migrating (which could be expensive and surprising), we use
a detect-and-expose pattern:

```typescript
// On Harness:
async embeddingStatus(): Promise<{ currentId: string; storedId: string | null; migrationNeeded: boolean }>
async migrateEmbeddings(embeddingFn: EmbeddingFn, batchEmbeddingFn: BatchEmbeddingFn, newId: string): Promise<{ reEmbedded: number; failed: number }>
```

The apps layer (OpenClaw plugin) calls `embeddingStatus()` on bootstrap and
warns/migrates as appropriate. Core provides the mechanism; apps decide policy.

### How Apps Become Thin Adapters

After this change, the OpenClaw context-engine becomes a thin adapter:

```
OpenClaw lifecycle        →  db0 core call
─────────────────────────────────────────
bootstrap()               →  harness.context() init
assemble() memory search  →  context.pack(query)
ingest() per-turn         →  context.ingest(content, opts)
afterTurn() batch extract →  context.preserve(messages)
reconcile()               →  context.reconcile()
compact() safety snapshot →  (stays in apps — OpenClaw-specific)
```

The ~500 lines of quality logic (writeFactWithQuality, formatMemories,
collectEdges, reconcile) move from `context-engine.ts` into core's
`Context` class. The OpenClaw engine keeps only:
- OpenClaw-specific types and lifecycle mapping
- File-watching and workspace integration (memory-backend.ts)
- Compaction safety snapshots (OpenClaw-specific feature)
- Embedding provider creation (provider configs stay in apps)

## What This Does NOT Do

- Does not create a full "context engine" in core — that's a framework concept
- Does not auto-trigger preserve or reconcile — apps decide when
- Does not own the embedding provider lifecycle — apps create the functions
- Does not replace OpenClaw's memory-backend — file watching stays in apps
- Does not add new profile presets — existing presets get the `context` section

## Migration Path

1. Add types and Context class to core (this PR)
2. OpenClaw context-engine delegates to core Context for quality logic
3. Other integrations can use `harness.context()` directly
4. No breaking changes — all new additions are optional
