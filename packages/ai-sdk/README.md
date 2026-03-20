# @db0-ai/ai-sdk

Persistent memory for the [Vercel AI SDK](https://ai-sdk.dev). Wrap any language model with db0 to give it memory that persists across sessions — no infrastructure, no LLM calls for extraction.

## Quick Start

```bash
npm install @db0-ai/ai-sdk ai
```

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, wrapLanguageModel } from "ai";
import { createDb0 } from "@db0-ai/ai-sdk";

const memory = await createDb0();

const model = wrapLanguageModel({
  model: anthropic("claude-sonnet-4-20250514"),
  middleware: memory.middleware,
});

// Memory is automatic — facts are extracted and recalled transparently
const { text } = await generateText({
  model,
  prompt: "My name is Alice and I prefer dark mode",
});

// Later, in a new session:
memory.newSession();
const { text: text2 } = await generateText({
  model,
  prompt: "What do you know about me?",
});
// → "You're Alice, and you prefer dark mode."

memory.close();
```

## What It Does

**Before each LLM call:** searches memory for facts relevant to the current message and injects them into the system prompt.

**After each LLM call:** extracts facts from the user message and assistant response using rules-based extraction (zero LLM calls) and stores them with deduplication and contradiction detection.

## Three Ways to Use It

### 1. Middleware (automatic, invisible)

Wraps any model. Memory injection and extraction happen transparently.

```typescript
import { wrapLanguageModel } from "ai";
import { createDb0 } from "@db0-ai/ai-sdk";

const memory = await createDb0();
const model = wrapLanguageModel({
  model: yourModel,
  middleware: memory.middleware,
});
```

### 2. Tools (agent-controlled)

Give the LLM explicit tools to read and write memories. Best for agents that should decide what to remember.

```typescript
import { generateText } from "ai";
import { createDb0 } from "@db0-ai/ai-sdk";

const memory = await createDb0();

const { text } = await generateText({
  model: yourModel,
  tools: memory.tools,
  maxSteps: 3,
  prompt: "Remember that I always use bun instead of npm",
});
```

### 3. Both (middleware + tools)

Automatic recall via middleware, plus tools for when the LLM wants explicit control.

```typescript
const model = wrapLanguageModel({
  model: yourModel,
  middleware: memory.middleware,
});

const { text } = await generateText({
  model,
  tools: memory.tools,
  maxSteps: 3,
  prompt: "What do you remember about my preferences?",
});
```

## Configuration

```typescript
const memory = await createDb0({
  dbPath: "./my-app.sqlite",     // default: "./db0.sqlite"
  agentId: "my-agent",           // default: "ai-sdk"
  userId: "user-123",            // default: "default"
  tokenBudget: 2000,             // tokens for packed memories (default: 1500)
  extractOnResponse: true,       // auto-extract facts (default: true)
});
```

## Session Management

```typescript
// Start a new session (clears conversation context, keeps memories)
memory.newSession();

// Or with a specific session ID
memory.newSession("checkout-flow-v2");
```

## Direct Harness Access

For advanced usage, access the db0 harness directly:

```typescript
const { harness } = memory;

// Pack context manually
const ctx = await harness.context().pack("user preferences", { tokenBudget: 1000 });

// Write memories directly
await harness.memory().write({
  content: "User is a senior engineer",
  scope: "user",
  embedding: await embed("User is a senior engineer"),
});

// Spawn sub-agents
const child = harness.spawn({ agentId: "researcher", sessionId: "r1" });
```

## Works With Any Provider

The middleware wraps the model, not the provider. Use it with any Vercel AI SDK provider:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

// All of these work
wrapLanguageModel({ model: anthropic("claude-sonnet-4-20250514"), middleware: memory.middleware });
wrapLanguageModel({ model: openai("gpt-4o"), middleware: memory.middleware });
wrapLanguageModel({ model: google("gemini-2.5-flash"), middleware: memory.middleware });
```

## Part of db0

This package is one entry point to the db0 SDK. The same memory database works with the [core SDK](../core), [OpenClaw plugin](../apps/openclaw), [Claude Code MCP server](../apps/claude-code), [CLI](../cli), and [inspector](../inspector).

## License

MIT
