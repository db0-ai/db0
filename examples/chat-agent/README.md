# db0 Chat Agent

A Next.js chatbot with persistent memory powered by db0. Demonstrates what the AI SDK doesn't provide out of the box: **a memory system that works across conversations.**

## What it shows

1. **Agent memory** — tell the agent your preferences in one chat. Start a new chat — it still knows. This is `context().pack()` retrieving relevant facts from past sessions and injecting them into the system prompt.

2. **Automatic fact extraction** — when you say "I always use TypeScript," db0 extracts that as a durable fact. No manual save commands. Rules-based extraction, zero LLM calls.

3. **Chat history handled by AI SDK** — message persistence uses `useChat` and `streamText` as intended. db0 doesn't replace this — it adds the memory layer on top.

## Run

```bash
cd examples/chat-agent
npm install
```

Create `.env.local`:

```
OPENAI_API_KEY=sk-...
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Try it

1. Say: **"My name is Alice and I prefer concise bullet-point responses"**
2. Reload the page (starts a new chat session)
3. Ask: **"What do you know about me?"**

The agent remembers your name and preference — pulled from db0's memory, not from the current chat history.

## How it works

```
User message
  │
  ├─ context().pack() → searches past memories, injects into system prompt
  │
  ▼
  streamText() → LLM generates response
  │
  ├─ AI SDK streams response to client
  │
  ▼
  onFinish → extraction().extract() → stores durable facts for future sessions
```

### Key files

| File | What it does |
|---|---|
| `lib/db0.ts` | Singleton harness factory — SQLite backend, shared across requests |
| `app/api/chat/route.ts` | API route — `context().pack()` before LLM call, fact extraction after |
| `app/page.tsx` | Chat UI with `useChat` — standard AI SDK pattern |

### What db0 adds (30 lines)

```typescript
// Before the LLM call — inject memories from past sessions
const ctx = await harness.context().pack(lastUserMessage, { tokenBudget: 2000 });

// In the system prompt
const system = ctx.count > 0
  ? `You are a helpful assistant.\n\nContext from past conversations:\n${ctx.text}`
  : "You are a helpful assistant.";

// After the LLM responds — extract facts for future sessions
const facts = await extraction.extract(text);
for (const fact of facts) {
  await harness.context().ingest(fact.content, { scope: fact.scope });
}
```

## Production

SQLite works for local dev. For production (Vercel, Railway, etc.), swap to Postgres:

```typescript
// lib/db0.ts — one line change
import { createPostgresBackend } from "@db0-ai/backends-postgres";

const backend = await createPostgresBackend(process.env.DATABASE_URL!);
```

Note: SQLite does **not** work on Vercel serverless (no persistent disk). Use Neon or Supabase.

## Inspect memories

```bash
npx @db0-ai/inspector --db ./memory.sqlite
```

Opens a web UI to browse, search, and manage stored memories.
