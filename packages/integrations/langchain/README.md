# @db0-ai/langchain

## The Problem

LangChain.js [deprecated all memory classes](https://docs.langchain.com/oss/javascript/migrate/langchain-v1) (`BufferMemory`, `ConversationSummaryMemory`, etc.) in v0.3.1. The recommended replacement — LangGraph checkpointers and Store — has real issues:

- **4-6 packages to assemble.** Checkpointers, stores, and embedding providers are all separate packages with [poorly documented interfaces](https://github.com/langchain-ai/langgraphjs/issues/545). Getting them to work together is non-trivial.
- **Messages vanish silently.** The recommended `createAgent` + checkpointer pattern has a [bug where messages disappear after server restart](https://github.com/langchain-ai/langchainjs/issues/10144) with no error. Thread metadata persists but conversations are empty.
- **Store bugs block production.** `store.get()` works locally but [throws errors on LangGraph Platform](https://github.com/langchain-ai/langgraphjs/issues/1611). `PostgresStore` has an [encoding bug](https://github.com/langchain-ai/langgraph/issues/2924) where data is stored but unretrievable.
- **No memory extraction in JavaScript.** LangMem (automatic fact extraction) is Python-only. JS developers must manually decide what to store and when.
- **Self-hosted vs. platform is unclear.** Developers [can't tell what requires LangGraph Platform](https://forum.langchain.com/t/persistence-long-term-memory/404) (the paid service) vs. what they can run themselves.

`@db0-ai/langchain` replaces all of that with one package. Persistent memory that works locally — scoped, versioned, with automatic fact extraction. SQLite or Postgres, no platform dependency.

## Quick Start

```bash
npm install @db0-ai/langchain @langchain/core
```

```typescript
import { createDb0 } from "@db0-ai/langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const memory = await createDb0();

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: "claude-sonnet-4-20250514" }),
  tools: [...memory.tools],  // db0_memory_write, db0_memory_search, db0_memory_list
});

await agent.invoke({
  messages: [{ role: "user", content: "Remember that I prefer dark mode" }],
});

// New session — agent can search its memory
memory.newSession();
const result = await agent.invoke({
  messages: [{ role: "user", content: "What are my preferences?" }],
});
```

## What You Get

- **Memory tools** — `db0_memory_write`, `db0_memory_search`, `db0_memory_list` as LangChain `DynamicStructuredTool`s, ready for any agent
- **Chat message history** — `Db0ChatMessageHistory` implements `BaseListChatMessageHistory` with automatic fact extraction on every message
- **One package** — no checkpointer packages, no store packages, no embedding provider packages
- **Local-first** — SQLite by default, Postgres for production. No cloud service, no platform lock-in
- **Automatic extraction** — rules-based fact detection from conversations, zero LLM calls

## Two Ways to Use It

### 1. Agent Tools

Give the agent explicit tools to manage memory. Best for agents that should decide what to remember.

```typescript
const memory = await createDb0();

const agent = createReactAgent({
  llm: yourModel,
  tools: [...yourTools, ...memory.tools],
});
```

### 2. Chat Message History

Drop-in replacement for deprecated `BufferMemory` / `ConversationSummaryMemory`. Stores messages and extracts facts automatically.

```typescript
import { Db0ChatMessageHistory } from "@db0-ai/langchain";

const history = new Db0ChatMessageHistory({ harness: memory.harness });

await history.addUserMessage("I always use TypeScript with strict mode");
await history.addAIMessage("Got it! I'll remember your TypeScript preference.");

// Facts extracted automatically — searchable across sessions
const messages = await history.getMessages();
```

## Use Cases

### ReAct agent that learns from past tasks

An agent that remembers solutions to problems it's solved before — across sessions, without you managing any storage.

```typescript
const memory = await createDb0({ agentId: "code-reviewer" });

const agent = createReactAgent({
  llm: yourModel,
  tools: [...memory.tools, fileReadTool, shellTool],
});

// Session 1: agent fixes a CORS issue
await agent.invoke({
  messages: [{ role: "user", content: "Fix the CORS error in our API" }],
});
// Agent calls db0_memory_write to save the solution

// Session 2: similar issue in a different project
memory.newSession();
await agent.invoke({
  messages: [{ role: "user", content: "I'm getting CORS errors again" }],
});
// Agent calls db0_memory_search, finds the previous fix
```

### Multi-user chatbot with per-user memory

Each user gets isolated memory. One SQLite file, scoped by `userId`.

```typescript
async function handleMessage(userId: string, message: string) {
  const memory = await createDb0({ userId, agentId: "support-bot" });

  const agent = createReactAgent({
    llm: yourModel,
    tools: [...memory.tools],
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: message }],
  });

  memory.close();
  return result;
}
```

### Migrating from deprecated BufferMemory

Before (deprecated):

```typescript
import { BufferMemory } from "langchain/memory";  // ⚠️ deprecated in v0.3.1
import { ConversationChain } from "langchain/chains";

const memory = new BufferMemory();
const chain = new ConversationChain({ llm, memory });
```

After:

```typescript
import { createDb0 } from "@db0-ai/langchain";

const memory = await createDb0();
// Use memory.chatHistory for message storage with automatic extraction
// Use memory.tools for agent-controlled memory
// Facts persist to SQLite — no more in-memory-only conversations
```

### RAG pipeline with persistent knowledge

Ingest documents into db0's scoped memory, then search them with hybrid scoring.

```typescript
const memory = await createDb0({ agentId: "knowledge-base" });
const { harness } = memory;

// Ingest documents
for (const doc of documents) {
  await harness.context().ingest(doc.content, {
    scope: "agent",
    tags: ["knowledge", doc.category],
  });
}

// Search with hybrid scoring (similarity + recency + popularity)
const ctx = await harness.context().pack("How does authentication work?", {
  tokenBudget: 3000,
});
// ctx.text → relevant knowledge, ready for the system prompt
```

## Configuration

```typescript
const memory = await createDb0({
  dbPath: "./my-app.sqlite",   // default: "./db0.sqlite"
  agentId: "my-agent",         // default: "langchain"
  userId: "user-123",          // default: "default"
  extractFacts: true,          // auto-extract from chat history (default: true)
});
```

### PostgreSQL for Production

```typescript
import { createPostgresBackend } from "@db0-ai/backends-postgres";

const backend = await createPostgresBackend(process.env.DATABASE_URL!);
const memory = await createDb0({ backend });
```

## Session Management

```typescript
// Start a new session (conversation resets, memories persist)
const { harness, chatHistory } = memory.newSession();

// Or with a specific session ID
const { harness, chatHistory } = memory.newSession("onboarding-v2");
```

## Direct Harness Access

For advanced usage beyond what tools and chat history provide:

```typescript
const { harness } = memory;

// Pack context for a custom prompt
const ctx = await harness.context().pack("user preferences", { tokenBudget: 1000 });

// Spawn sub-agents with shared memory
const child = harness.spawn({ agentId: "researcher", sessionId: "r1" });
```

## Part of db0

This package is one entry point to the db0 SDK. The same memory database works with the [core SDK](../../core), [AI SDK integration](../ai-sdk), [OpenClaw plugin](../../apps/openclaw), [Claude Code MCP server](../../apps/claude-code), [CLI](../../cli), and [inspector](../../inspector).

## License

MIT
