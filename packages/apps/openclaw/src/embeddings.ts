import { defaultEmbeddingFn } from "@db0-ai/core";
import { log } from "./logger.js";

/**
 * Supported embedding providers — users select by name in config,
 * no code changes needed.
 */
export type EmbeddingProvider = "hash" | "ollama" | "openai" | "gemini";

export interface EmbeddingProviderConfig {
  /** Provider name. Default: "hash" (built-in, zero-config). */
  provider?: EmbeddingProvider;
  /** Model name. Provider-specific defaults apply if omitted. */
  model?: string;
  /** API key. Falls back to provider-specific env vars. */
  apiKey?: string;
  /** Base URL override (e.g. custom Ollama host). */
  baseUrl?: string;
  /**
   * Output dimensions for providers that support it (Gemini, OpenAI text-embedding-3-*).
   * Smaller dimensions = faster search + less storage, with some quality tradeoff.
   */
  dimensions?: number;
}

/**
 * Create an embedding function from a simple config object.
 *
 * Users configure this via openclaw.json:
 * ```json
 * { "plugins": { "entries": { "db0": { "embeddings": "gemini" } } } }
 * ```
 *
 * Or with options:
 * ```json
 * { "plugins": { "entries": { "db0": {
 *     "embeddings": { "provider": "gemini", "model": "gemini-embedding-2-preview", "dimensions": 768 }
 * } } } }
 * ```
 */
export type EmbeddingFn = (text: string) => Promise<Float32Array>;
export type BatchEmbeddingFn = (texts: string[]) => Promise<Float32Array[]>;

export function createEmbeddingFn(
  config?: EmbeddingProviderConfig | EmbeddingProvider | string,
): EmbeddingFn {
  if (!config) return defaultEmbeddingFn;

  const normalized: EmbeddingProviderConfig =
    typeof config === "string" ? { provider: config as EmbeddingProvider } : config;

  switch (normalized.provider) {
    case "gemini":
      return createGeminiEmbedding(normalized);
    case "ollama":
      return createOllamaEmbedding(normalized);
    case "openai":
      return createOpenAIEmbedding(normalized);
    case "hash":
    default:
      return defaultEmbeddingFn;
  }
}

/**
 * Create a batch embedding function for bulk operations (migration, re-indexing).
 * Uses provider-native batch APIs where available (Gemini batchEmbedContents, OpenAI batch input).
 * Falls back to concurrent single calls for providers without batch support.
 */
export function createBatchEmbeddingFn(
  config?: EmbeddingProviderConfig | EmbeddingProvider | string,
): BatchEmbeddingFn {
  if (!config) return fallbackBatch(defaultEmbeddingFn);

  const normalized: EmbeddingProviderConfig =
    typeof config === "string" ? { provider: config as EmbeddingProvider } : config;

  switch (normalized.provider) {
    case "gemini":
      return createGeminiBatchEmbedding(normalized);
    case "openai":
      return createOpenAIBatchEmbedding(normalized);
    case "ollama":
      return fallbackBatch(createOllamaEmbedding(normalized));
    case "hash":
    default:
      return fallbackBatch(defaultEmbeddingFn);
  }
}

/** Wrap a single-text embedding function into a sequential batch function. */
function fallbackBatch(singleFn: EmbeddingFn): BatchEmbeddingFn {
  return async (texts: string[]) => {
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await singleFn(text));
    }
    return results;
  };
}

/**
 * Derive a stable embedding ID string from provider config.
 * Used to detect when the embedding provider changes and migration is needed.
 */
export function deriveEmbeddingId(
  config?: EmbeddingProviderConfig | EmbeddingProvider | string,
): string {
  if (!config) return "hash";

  const normalized: EmbeddingProviderConfig =
    typeof config === "string" ? { provider: config as EmbeddingProvider } : config;

  const provider = normalized.provider ?? "hash";
  const model = normalized.model ?? defaultModelFor(provider);
  const dims = normalized.dimensions ? `:${normalized.dimensions}` : "";

  return `${provider}:${model}${dims}`;
}

function defaultModelFor(provider: EmbeddingProvider): string {
  switch (provider) {
    case "gemini": return "gemini-embedding-2-preview";
    case "ollama": return "nomic-embed-text";
    case "openai": return "text-embedding-3-small";
    case "hash":
    default: return "hash-128";
  }
}

/**
 * Auto-detect the best available embedding provider.
 * Checks in order: Gemini (env var, free) → Ollama (local) → OpenAI (env var) → hash (fallback).
 */
export async function autoDetectProvider(): Promise<EmbeddingProvider> {
  // Check Gemini first — free tier, high quality
  if (resolveGeminiApiKey()) return "gemini";

  // Check Ollama
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) return "ollama";
  } catch {
    // Not running
  }

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) return "openai";

  return "hash";
}

// === Providers ===

function resolveGeminiApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_AI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    undefined
  );
}

function createGeminiEmbedding(
  config: EmbeddingProviderConfig,
): (text: string) => Promise<Float32Array> {
  const model = config.model ?? "gemini-embedding-2-preview";
  const apiKey = config.apiKey ?? resolveGeminiApiKey();

  if (!apiKey) {
    throw new Error(
      "[db0] Gemini embeddings require an API key. " +
      "Set GEMINI_API_KEY or GOOGLE_AI_API_KEY env var, or pass apiKey in config.",
    );
  }

  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const dimensions = config.dimensions;

  return async (text: string): Promise<Float32Array> => {
    const body: Record<string, unknown> = {
      model: `models/${model}`,
      content: { parts: [{ text }] },
    };
    if (dimensions) {
      body.outputDimensionality = dimensions;
    }

    const res = await fetch(
      `${baseUrl}/models/${model}:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`[db0] Gemini embedding failed (${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as {
      embedding: { values: number[] };
    };
    return new Float32Array(json.embedding.values);
  };
}

/** Gemini batchEmbedContents — up to 100 texts per request. */
function createGeminiBatchEmbedding(
  config: EmbeddingProviderConfig,
): BatchEmbeddingFn {
  const model = config.model ?? "gemini-embedding-2-preview";
  const apiKey = config.apiKey ?? resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error("[db0] Gemini embeddings require an API key.");
  }
  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const dimensions = config.dimensions;
  const BATCH_SIZE = 100; // Gemini batch limit

  return async (texts: string[]): Promise<Float32Array[]> => {
    const allResults: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const requests = batch.map((text) => {
        const req: Record<string, unknown> = {
          model: `models/${model}`,
          content: { parts: [{ text }] },
        };
        if (dimensions) {
          req.outputDimensionality = dimensions;
        }
        return req;
      });

      // Retry up to 3 times with backoff
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(
            `${baseUrl}/models/${model}:batchEmbedContents?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requests }),
            },
          );

          if (!res.ok) {
            const errBody = await res.text();
            const err = new Error(`[db0] Gemini batch embedding failed (${res.status}): ${errBody}`);
            if (res.status === 503 || res.status === 429) {
              lastErr = err;
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
              continue;
            }
            throw err;
          }

          const json = (await res.json()) as {
            embeddings: Array<{ values: number[] }>;
          };
          for (const emb of json.embeddings) {
            allResults.push(new Float32Array(emb.values));
          }
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      }

      if (lastErr) throw lastErr;

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < texts.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return allResults;
  };
}

/** OpenAI batch embedding — supports array input natively. */
function createOpenAIBatchEmbedding(
  config: EmbeddingProviderConfig,
): BatchEmbeddingFn {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const model = config.model ?? "text-embedding-3-small";
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  const dimensions = config.dimensions;
  if (!apiKey) {
    throw new Error("[db0] OpenAI embeddings require an API key.");
  }
  const BATCH_SIZE = 2048; // OpenAI supports up to 2048 inputs

  return async (texts: string[]): Promise<Float32Array[]> => {
    const allResults: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const body: Record<string, unknown> = { model, input: batch };
      if (dimensions) body.dimensions = dimensions;

      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`[db0] OpenAI batch embedding failed (${res.status}): ${errBody}`);
      }

      const json = (await res.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };
      // Sort by index to maintain order
      const sorted = json.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        allResults.push(new Float32Array(item.embedding));
      }
    }

    return allResults;
  };
}

function createOllamaEmbedding(
  config: EmbeddingProviderConfig,
): (text: string) => Promise<Float32Array> {
  const baseUrl = config.baseUrl ?? "http://localhost:11434";
  const model = config.model ?? "nomic-embed-text";
  let modelChecked = false;

  return async (text: string): Promise<Float32Array> => {
    // On first call, try to pull the model if not available
    if (!modelChecked) {
      modelChecked = true;
      try {
        const tags = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(2000),
        });
        if (tags.ok) {
          const { models } = (await tags.json()) as { models: Array<{ name: string }> };
          const hasModel = models.some(
            (m) => m.name === model || m.name.startsWith(`${model}:`),
          );
          if (!hasModel) {
            log.info(`[db0] Pulling embedding model "${model}"... (one-time)`);
            await fetch(`${baseUrl}/api/pull`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: model }),
            });
          }
        }
      } catch {
        // Best-effort model check
      }
    }

    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `[db0] Ollama embedding failed (${res.status}): ${body}. ` +
        `Is Ollama running? Try: ollama serve`,
      );
    }

    const { embedding } = (await res.json()) as { embedding: number[] };
    return new Float32Array(embedding);
  };
}

function createOpenAIEmbedding(
  config: EmbeddingProviderConfig,
): (text: string) => Promise<Float32Array> {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const model = config.model ?? "text-embedding-3-small";
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  const dimensions = config.dimensions;

  if (!apiKey) {
    throw new Error(
      "[db0] OpenAI embeddings require an API key. " +
      "Set OPENAI_API_KEY env var or pass apiKey in config.",
    );
  }

  return async (text: string): Promise<Float32Array> => {
    const body: Record<string, unknown> = { model, input: text };
    if (dimensions) {
      body.dimensions = dimensions;
    }

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[db0] OpenAI embedding failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return new Float32Array(json.data[0].embedding);
  };
}
