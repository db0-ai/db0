# @db0-ai/ai-sdk

The [AI SDK](https://ai-sdk.dev) is stateless by design. Every `generateText` call starts from zero — no memory of past conversations, no way to recall what the user said yesterday. The SDK's own [memory docs](https://ai-sdk.dev/docs/agents/memory) acknowledge this gap and point to third-party services.

In practice, this means:

- **Users repeat themselves.** "I told you my name last session" — but the model has no idea.
- **Every team builds the same glue.** Persistence is the [#1 recurring pain](https://github.com/vercel/ai/discussions/4845) in the AI SDK community. Multiple message formats, streaming race conditions, no reference implementation.
- **Long conversations break.** The full message history is sent on every request. No built-in compaction, no context window management. Conversations over 150 messages require custom summarization.

`@db0-ai/ai-sdk` solves this as a middleware. Wrap any model — facts are extracted from conversations automatically (zero LLM calls), stored in SQLite or Postgres, and injected back into the prompt when relevant.

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

## Runtime Compatibility

db0's default SQLite backend requires **Node.js runtime** — it won't work on Vercel Edge Functions or Cloudflare Workers.

For **Next.js**, set the runtime on your API route:

```typescript
// app/api/chat/route.ts
export const runtime = "nodejs"; // required for db0 SQLite
```

For **edge deployments**, use the PostgreSQL backend with a hosted database (Neon, Supabase, Vercel Postgres):

```typescript
import { createDb0 } from "@db0-ai/ai-sdk";
import { createPostgresBackend } from "@db0-ai/backends-postgres";

const backend = await createPostgresBackend(process.env.DATABASE_URL!);
const memory = await createDb0({ backend });
```

## Configuration

```typescript
const memory = await createDb0({
  dbPath: "./my-app.sqlite",     // default: "./db0.sqlite"
  agentId: "my-agent",           // default: "ai-sdk"
  userId: "user-123",            // default: "default"
  tokenBudget: 2000,             // tokens for packed memories (default: 1500)
  extractOnResponse: true,       // auto-extract facts (default: true)
  consolidateFn: async (memories) => {  // optional: LLM-assisted memory merging
    const res = await generateText({ model, prompt: `Merge: ${memories.map(m => m.content).join("; ")}` });
    return { content: res.text };
  },
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

## Use Cases

### Customer support bot that knows your history

Users hate repeating themselves. With db0, the bot remembers past issues, preferences, and account context across every conversation.

```typescript
const memory = await createDb0({ userId: session.userId, agentId: "support-bot" });
const model = wrapLanguageModel({ model: yourModel, middleware: memory.middleware });

// First conversation
await generateText({ model, prompt: "I'm having trouble with billing. I'm on the Pro plan." });

// Weeks later — bot remembers the user is on Pro plan
await generateText({ model, prompt: "I need to upgrade my account" });
// → Knows user is already on Pro, offers relevant upgrade paths
```

### AI tutor that tracks progress

An AI tutor that remembers what the student has learned, where they struggle, and adapts its teaching style over time.

```typescript
const memory = await createDb0({ userId: studentId, agentId: "tutor" });
const model = wrapLanguageModel({ model: yourModel, middleware: memory.middleware });

// Session 1: student struggles with recursion
await generateText({ model, prompt: "I don't understand how recursion works" });

// Session 5: tutor recalls earlier struggles
await generateText({ model, prompt: "Can you explain tree traversal?" });
// → "Since you've been working on recursion, tree traversal is a natural next step..."
```

### Multi-tenant SaaS with per-user memory

Each user gets their own memory scope. One SQLite file per user, or shared Postgres with `userId` isolation.

```typescript
// In your Next.js API route
export async function POST(req: Request) {
  const { userId } = await auth();
  const { messages } = await req.json();

  const memory = await createDb0({
    dbPath: `./data/${userId}.sqlite`,
    userId,
  });

  const model = wrapLanguageModel({ model: yourModel, middleware: memory.middleware });

  const result = streamText({ model, messages });
  memory.close();
  return result.toDataStreamResponse();
}
```

### Research agent with tool-controlled memory

An agent that decides what's worth remembering. Uses tools to save key findings and search past research.

```typescript
const memory = await createDb0({ agentId: "researcher" });
const model = wrapLanguageModel({ model: yourModel, middleware: memory.middleware });

const { text } = await generateText({
  model,
  tools: {
    ...memory.tools,           // db0_memory_write, db0_memory_search, db0_memory_list
    webSearch: mySearchTool,   // your other tools
  },
  maxSteps: 10,
  prompt: "Research the latest developments in WebAssembly and save the key findings",
});
// Agent searches, reads, and explicitly saves important facts to memory
```

### Onboarding flow that picks up where you left off

User closes the tab halfway through onboarding. When they come back, the agent knows exactly where they stopped.

```typescript
const memory = await createDb0({ userId, agentId: "onboarding" });
const model = wrapLanguageModel({ model: yourModel, middleware: memory.middleware });

// User completed steps 1-3 yesterday, closed the tab
// Today — agent recalls progress automatically
await generateText({
  model,
  prompt: "I want to continue setting up my account",
});
// → "Welcome back! You've already connected your GitHub repo and set up CI.
//    Next up is configuring your deployment settings."
```

## Part of db0

This package is one entry point to the db0 SDK. The same memory database works with the [core SDK](../../core), [OpenClaw plugin](../../apps/openclaw), [Claude Code MCP server](../../apps/claude-code), [CLI](../../cli), and [inspector](../../inspector).

## License

MIT
