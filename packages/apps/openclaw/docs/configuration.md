# Configuration Reference

## Options

| Option | Default | Description |
|---|---|---|
| `storage` | `~/.openclaw/db0.sqlite` | File path, `"postgresql://..."`, `":memory:"`, or a `Db0Backend` instance |
| `embeddingFn` | built-in hash | `(text: string) => Promise<Float32Array>` |
| `extraction` | `"rules"` | `"rules"`, `"llm"`, or `"manual"` |
| `llm` | — | LLM extraction config (required when `extraction` is `"llm"`) |
| `userId` | auto-detected | Stable user identity for `user` scope isolation. Uses `DB0_USER_ID`/`OPENCLAW_USER_ID`, then OS username |
| `summarizeFn` | first-sentence | Custom summary function for L0 context tiering |
| `searchLimit` | `8` | Max memories per search |
| `minScore` | `0.4` | Cosine similarity threshold (raise to 0.65+ with real embeddings) |

## Upgrade Path

```typescript
// Default: persistent SQLite + hash embeddings + rules extraction
db0()

// Semantic search with real embeddings
db0({ embeddingFn: myEmbed, minScore: 0.65 })

// Cross-device sync via hosted Postgres (Neon, Supabase, etc.)
db0({ storage: "postgresql://...@your-host/db0", embeddingFn: myEmbed })
```

## Cross-Device Memory with Hosted Postgres

For memory that syncs across machines, use any hosted Postgres with pgvector (Neon, Supabase, Railway, etc.):

```bash
npm install @db0-ai/backends-postgres
```

```typescript
db0({
  storage: "postgresql://user:pass@your-host/db0",
  embeddingFn: myEmbed,
  minScore: 0.65,
})
```

Your memories, state, and logs are now in the cloud. Any device with the same connection string shares the same agent memory.

## Backup & Restore

With a hosted Postgres backend, db0 automatically backs up workspace files on every session. If local data is lost:

```bash
# See what's available to restore
npx @db0-ai/openclaw restore --dry-run

# Restore workspace from backend
npx @db0-ai/openclaw restore

# Force overwrite existing files
npx @db0-ai/openclaw restore --force
```

## Session Reset

db0 preserves memory across sessions, but OpenClaw's default session reset policy may discard conversation context too aggressively. If your sessions reset before db0 has time to extract facts, increase the idle timeout in `~/.openclaw/openclaw.json`:

```json
{
  "session": {
    "reset": {
      "mode": "idle",
      "idleMinutes": 10080
    }
  }
}
```

| Value | Duration |
|---|---|
| `1440` | 1 day |
| `10080` | 7 days (recommended starting point) |
| `43200` | 30 days |

This only affects when OpenClaw starts a *new* session — db0's extracted memories persist regardless of session resets.

## L0 Context Tiering

Every memory gets an auto-generated one-line summary (L0) stored alongside the full content (L2). During `assemble()`, summaries are used for context injection — fitting more memories into the token budget.

```typescript
// Default: first-sentence extraction
const entry = await harness.memory().write({
  content: "User prefers dark mode. They find it easier on the eyes during long sessions.",
  scope: "user",
  embedding,
});
// entry.summary → "User prefers dark mode."

// Explicit summary
await harness.memory().write({
  content: "Long detailed memory...",
  scope: "user",
  embedding,
  summary: "Custom one-liner",
});

// Custom summarize function (e.g., LLM-powered)
db0({
  summarizeFn: async (content) => callLLM(`Summarize in one line: ${content}`),
})
```
