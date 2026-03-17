# Embedding Providers

> **Recommended:** Use the CLI to configure embeddings — no code changes needed:
> ```bash
> npx @db0-ai/openclaw set embeddings ollama
> ```
> The code examples below are for advanced usage or non-OpenClaw integrations.

The built-in hash embeddings work for exact and near-exact recall with zero setup. For real semantic search, pass your own `embeddingFn`:

## OpenAI

```typescript
import OpenAI from "openai";
const openai = new OpenAI();

db0({
  embeddingFn: async (text) => {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return new Float32Array(res.data[0].embedding);
  },
  minScore: 0.65,
})
```

## Ollama (local)

```typescript
db0({
  embeddingFn: async (text) => {
    const res = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
    });
    const { embedding } = await res.json();
    return new Float32Array(embedding);
  },
  minScore: 0.65,
})
```

## transformers.js (fully local, no API)

```typescript
import { pipeline } from "@xenova/transformers";
const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

db0({
  embeddingFn: async (text) => {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return new Float32Array(output.data);
  },
  minScore: 0.65,
})
```
