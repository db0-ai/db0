# Sub-Agent Support

db0 implements OpenClaw 3.8's sub-agent lifecycle hooks using a **shared backend** model. Parent and child agents share the same database — no text copy-paste, no extraction gymnastics.

## How It Works

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

## `prepareSubagentSpawn`

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

## `onSubagentEnded`

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

## Direct Harness Access

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

const child = parent.spawn({
  agentId: "researcher",
  sessionId: "research-session-1",
});

// Child can read parent's user-scoped memories immediately
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

child.close();
parent.close();
```
