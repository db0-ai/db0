# Memory & Search

## Memory Scopes

| Scope | Lifetime | Example triggers |
|---|---|---|
| `user` | Permanent, cross-session | "user prefers", "always use", "remember that" |
| `session` | Current session | "decided to", "important:", "agreed to" |
| `task` | Current task | "working on", "current task", "next step" |
| `agent` | Permanent, all sessions | (manual writes only in v0.1) |

## Memory Superseding

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

## Hybrid Search

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

## Structured Content

Store strings or structured objects as memory content.

```typescript
// Plain string
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

## Memory Relationships

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

## State Branching

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
