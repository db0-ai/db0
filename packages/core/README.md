# @db0-ai/core

The core engine for [db0](https://github.com/db0-ai/db0) — the data layer for AI agents.

Provides the harness, primitives (memory, context, state, log, spawn), profiles, extraction strategies, and embedding utilities. All other db0 packages build on top of this.

## Install

```bash
npm install @db0-ai/core @db0-ai/backends-sqlite
```

## Usage

```typescript
import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

const backend = await createSqliteBackend();
const harness = db0.harness({
  agentId: "my-agent",
  sessionId: "s1",
  userId: "user-1",
  backend,
  embeddingFn: defaultEmbeddingFn,
  profile: PROFILE_CONVERSATIONAL,
});

// Memory — scoped, searchable, supersedable
await harness.memory().write({ content: "User prefers dark mode", scope: "user", embedding });

// Context — ingest, pack, preserve, reconcile
const ctx = await harness.context().pack("user preferences", { tokenBudget: 1500 });

// State — checkpoint and branch
await harness.state().checkpoint({ step: 1, label: "before-decision" });

// Sub-agents — shared backend, isolated sessions
const child = harness.spawn({ agentId: "researcher", sessionId: "s2" });

harness.close();
```

## Documentation

See the [main db0 README](https://github.com/db0-ai/db0) for full documentation.

## License

MIT
