# @db0-ai/langchain

LangChain.js [deprecated its memory classes](https://docs.langchain.com/oss/javascript/migrate/langchain-v1) in v0.3.1. The replacement — LangGraph checkpointers and Store — requires [4-6 packages](https://github.com/langchain-ai/langgraphjs/issues/545), has [namespace bugs that block production deployment](https://github.com/langchain-ai/langgraphjs/issues/1611), and offers no automatic memory extraction in JavaScript (LangMem is Python-only).

Meanwhile, developers report that [messages vanish after server restart](https://github.com/langchain-ai/langchainjs/issues/10144) with the recommended `createAgent` + checkpointer pattern, and the line between self-hosted and platform-dependent features [remains unclear](https://forum.langchain.com/t/persistence-long-term-memory/404).

`@db0-ai/langchain` gives your LangChain.js agents persistent memory that works locally — scoped, versioned, with automatic fact extraction. One package, SQLite or Postgres, no platform dependency.

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
