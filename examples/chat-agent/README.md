# Chat Agent Example

A terminal chatbot that remembers across sessions, built with db0.

## What it demonstrates

- **Persistent memory** — facts survive across sessions via SQLite
- **Automatic extraction** — rules-based fact detection from conversation (zero LLM calls)
- **Context packing** — relevant memories assembled into the system prompt with token budgets
- **Scoped memory** — user preferences stored with `user` scope, visible in every future session

## Run

```bash
ANTHROPIC_API_KEY=sk-... npx tsx examples/chat-agent/index.ts
```

## Try it

```
you: My name is Alice and I prefer dark mode
you: I always use TypeScript with strict mode
you: quit
```

Restart the agent — it remembers:

```
Memories from previous sessions (2):
  - User's name is Alice and prefers dark mode
  - User always uses TypeScript with strict mode

you: What do you know about me?
```

## How it works

1. On each turn, `context().pack()` searches memory and assembles relevant facts into the system prompt
2. After the LLM responds, `extraction().extract()` detects facts via signal-word matching
3. Detected facts are written via `context().ingest()` with deduplication and contradiction detection
4. Memory persists in `./chat-agent.sqlite` — delete it to start fresh
