# Legacy Migration

Import existing OpenClaw memories (MEMORY.md curated entries + daily `memory/YYYY-MM-DD.md` logs):

```typescript
import { migrateFromOpenClaw } from "@db0-ai/openclaw";

const result = await migrateFromOpenClaw({
  memoryDir: "~/.openclaw/memory",
  backend,
  agentId: "my-agent",
  embeddingFn: myEmbed,
  onProgress: (entry, i, total) => console.log(`${i}/${total}: ${entry.content}`),
});
// result → { imported: 42, skipped: 3, errors: [] }
```

MEMORY.md entries are imported as `user` scope. Daily log entries are imported as `session` scope with date tags.
