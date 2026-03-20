# Chat Agent Example

A terminal chatbot that remembers across sessions, built with db0.

## What it demonstrates

- **Persistent memory** — facts survive across sessions via SQLite
- **Automatic extraction** — rules-based fact detection from conversation (zero LLM calls)
- **Context packing** — relevant memories assembled into the system prompt with token budgets
- **Scoped memory** — user preferences stored with `user` scope, visible in every future session
- **Session management** — start fresh conversations while keeping memory intact

## Run

```bash
ANTHROPIC_API_KEY=sk-... npx tsx examples/chat-agent/index.ts
```

## Commands

| Command | What it does |
|---|---|
| `/new` | Start a new session — clears conversation history, keeps all memories |
| `/memory` | Show all stored memories |
| `/context` | Show what context would be packed for the LLM |
| `/forget` | Delete all memories and start fresh |
| `quit` | Exit |

## Try it

```
you: My name is Alice and I prefer dark mode
you: I always use TypeScript with strict mode
you: /memory              ← see what was extracted
you: /new                 ← start fresh session
you: What do you know about me?   ← memories are still there
you: /context             ← see what the LLM receives
you: Actually I switched to light mode   ← supersedes the old fact
you: /memory              ← old fact marked [superseded]
```

## How it works

1. On each turn, `context().pack()` searches memory and assembles relevant facts into the system prompt
2. After the LLM responds, `extraction().extract()` detects facts via signal-word matching
3. Detected facts are written via `context().ingest()` with deduplication and contradiction detection
4. `/new` creates a new harness with a fresh `sessionId` but the same backend — memory persists, conversation resets
5. Memory persists in `./chat-agent.sqlite` — delete it to start completely fresh
