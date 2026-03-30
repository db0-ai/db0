# Design: LLM-Assisted Memory Consolidation

**Status:** Proposed
**Issue:** [#15](https://github.com/db0-ai/db0/issues/15)
**Scope:** `packages/core/src/components/context.ts`

## Problem

`reconcile()` currently merges memories only when their **normalized text is exactly identical**. Two memories with the same meaning but different wording — "user likes TypeScript" and "user always uses TypeScript with strict mode" — are never merged because `factContent === matchContent` fails.

This means related facts accumulate over time without consolidation. For a long-lived agent, this leads to:
- Redundant context in `pack()` results (3 memories about TypeScript preferences instead of 1)
- Wasted token budget (each redundant fact consumes tokens)
- No synthesis (the agent never learns "user prefers TypeScript with strict mode and functional style" from three separate facts)

## Approach: Extend `reconcile()`, don't add a new method

The current `reconcile()` has the right three-step structure:
1. **Promote** high-access file-chunks to durable facts
2. **Merge** near-duplicate facts (currently: exact text match only)
3. **Clean** stale contradiction edges

The improvement is in **step 2**: when a `consolidateFn` is configured on the harness, `reconcile()` also clusters semantically similar (but not textually identical) memories and asks the LLM to merge them.

This avoids a separate method. Developers don't need to decide "should I call `reconcile()` or `consolidate()`?" — they just call `reconcile()` and it does the right thing based on configuration.

## API changes

### HarnessConfig

```typescript
interface HarnessConfig {
  // existing
  embeddingFn?: EmbeddingFn;
  extraction?: { durableFacts?: "rules" | "llm" | "manual" };

  // new
  consolidateFn?: (memories: Array<{
    content: string;
    scope: MemoryScope;
    tags: string[];
    createdAt: string;
  }>) => Promise<{
    content: string;
    tags?: string[];
  }>;
}
```

### Profile

```typescript
interface Db0Profile {
  reconciliation?: {
    interval?: number;                // existing — turns between reconcile()
    consolidateThreshold?: number;    // new — min similarity to cluster. Default: 0.75
    consolidateMinCluster?: number;   // new — min memories per cluster. Default: 2
    consolidateMaxClusters?: number;  // new — max clusters per run. Default: 10
  };
}
```

### ContextReconcileResult

```typescript
interface ContextReconcileResult {
  promoted: number;                // existing
  merged: number;                  // existing (exact dedup)
  contradictionsCleaned: number;   // existing
  consolidated: number;            // new — clusters merged via LLM
  consolidatedMemories: number;    // new — individual memories superseded by consolidation
}
```

## Algorithm

The reconcile flow becomes:

```
reconcile():
  Step 1: Promote high-access chunks (unchanged)
  Step 2a: Merge exact duplicates (unchanged)
  Step 2b: IF consolidateFn configured:
    - List remaining active facts (non-chunk, non-snapshot)
    - Cluster by embedding similarity ≥ consolidateThreshold
    - For each cluster with size ≥ consolidateMinCluster:
      - Call consolidateFn(cluster members)
      - Write merged memory (supersedes all members)
      - Track provenance: extractionMethod "consolidate", mergedFrom [ids]
  Step 3: Clean stale contradiction edges (unchanged)
```

### Clustering

Simple greedy clustering on precomputed embeddings:

```typescript
function clusterMemories(
  memories: MemoryEntry[],
  threshold: number,
): MemoryEntry[][] {
  const visited = new Set<string>();
  const clusters: MemoryEntry[][] = [];

  for (const mem of memories) {
    if (visited.has(mem.id)) continue;
    const cluster = [mem];
    visited.add(mem.id);

    for (const other of memories) {
      if (visited.has(other.id)) continue;
      if (cosineSimilarity(mem.embedding!, other.embedding!) >= threshold) {
        cluster.push(other);
        visited.add(other.id);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }

  return clusters;
}
```

O(n²) but memory counts per user are typically <1000. Can be optimized later if needed.

### Provenance

Consolidated memories carry full audit trail:

```typescript
{
  content: "User prefers TypeScript with strict mode and functional style",
  scope: "user",
  status: "active",
  extractionMethod: "consolidate",
  sourceType: "consolidation",
  metadata: {
    mergedFrom: ["mem_abc", "mem_def", "mem_ghi"],
    consolidatedAt: "2026-03-30T10:00:00Z",
    clusterSize: 3,
  },
}
```

All superseded originals remain in the database with `status: "superseded"`.

## Behavior without `consolidateFn`

If `consolidateFn` is not provided, step 2b is skipped entirely. `reconcile()` behaves exactly as it does today. This is the zero-config default — no LLM calls, no behavior change for existing users.

## Example `consolidateFn`

```typescript
const consolidateFn = async (memories) => {
  const prompt = `Merge these related facts into one concise statement.
Preserve all specifics (names, dates, numbers).
Do not add information not in the originals.

Facts:
${memories.map((m, i) => `${i + 1}. ${m.content}`).join("\n")}

Merged fact:`;

  const response = await callYourLLM(prompt);
  return { content: response.text.trim() };
};

const harness = db0.harness({
  agentId: "my-agent",
  sessionId: "s1",
  userId: "user-1",
  backend,
  consolidateFn,
});
```

## How apps trigger it

Same as today — apps call `reconcile()` at the right moment. The only difference is that with `consolidateFn` configured, the same call also does semantic merging.

| App | Trigger | How |
|---|---|---|
| OpenClaw | Every N turns (profile `reconciliation.interval`) | `afterTurn` hook |
| Claude Code | Session end or `/db0:dream` skill | MCP handler |
| AI SDK / LangChain | Explicit | `memory.harness.context().reconcile()` |
| Pi | `session_shutdown` event | Extension hook |

## What this does NOT do

- **No new public method.** `reconcile()` gets smarter, not replaced.
- **No background process.** Apps trigger it.
- **No session transcript scanning.** Operates on existing memories only.
- **No auto-provided LLM.** `consolidateFn` must be supplied by the app.

## Comparison with Claude Code auto-dream

| | db0 `reconcile()` + consolidateFn | Claude Code auto-dream |
|---|---|---|
| Audit trail | `mergedFrom` IDs, provenance, supersedes links | None |
| Trigger | App-controlled, profile-configurable | Server feature flag (24h + 5 sessions) |
| Extensibility | Pluggable `consolidateFn` | Closed system |
| Cost | Algorithmic first, LLM only for clusters | Full LLM subagent every run |
| Storage | Structured DB with embeddings | Flat markdown files |
| Session awareness | No (operates on existing memories) | Yes (reads past transcripts) |

## Implementation plan

1. Add `consolidateFn` to `HarnessConfig` type
2. Add `consolidateThreshold`, `consolidateMinCluster`, `consolidateMaxClusters` to profile type
3. Add clustering helper function
4. Extend `reconcile()` step 2 with consolidation pass
5. Update profile presets (conservative defaults)
6. Add tests: without `consolidateFn` (no behavior change), with mock `consolidateFn` (clusters merged correctly)
7. Update docs
