/**
 * db0 memory tools for the Vercel AI SDK.
 *
 * Provides tool definitions that let the LLM read and write memories directly.
 * Use alongside the middleware, or standalone for manual memory management.
 *
 * Usage:
 *   import { db0MemoryTools } from "@db0-ai/ai-sdk";
 *
 *   const result = await generateText({
 *     model,
 *     tools: db0MemoryTools({ harness }),
 *     prompt: "Remember that I prefer dark mode",
 *   });
 */

import { tool } from "ai";
import { z } from "zod";
import type { Harness } from "@db0-ai/core";
import { defaultEmbeddingFn } from "@db0-ai/core";
import type { MemoryScope } from "@db0-ai/core";

export interface Db0ToolsOptions {
  /** db0 harness instance */
  harness: Harness;
}

async function embed(harness: Harness, text: string): Promise<Float32Array> {
  // Access the config's embeddingFn if available, otherwise use default
  const fn = (harness as any).config?.embeddingFn ?? defaultEmbeddingFn;
  return fn(text);
}

export function db0MemoryTools(options: Db0ToolsOptions) {
  const { harness } = options;

  return {
    db0_memory_write: tool({
      description:
        "Store a fact in persistent memory. Use 'user' scope for preferences and personal info that should persist across all sessions. Use 'session' scope for temporary context.",
      inputSchema: z.object({
        content: z.string().describe("The fact to remember"),
        scope: z
          .enum(["user", "session", "task", "agent"])
          .default("user")
          .describe("Memory scope"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags for filtering"),
        supersedes: z
          .string()
          .optional()
          .describe("ID of a memory to supersede"),
      }),
      execute: async (input: {
        content: string;
        scope: MemoryScope;
        tags?: string[];
        supersedes?: string;
      }) => {
        const embedding = await embed(harness, input.content);
        const entry = await harness.memory().write({
          content: input.content,
          scope: input.scope,
          embedding,
          tags: input.tags,
          supersedes: input.supersedes,
        });
        return { id: entry.id, content: input.content, scope: input.scope, status: "saved" };
      },
    }),

    db0_memory_search: tool({
      description:
        "Search memories by meaning. Returns the most relevant memories for a query.",
      inputSchema: z.object({
        query: z.string().describe("What to search for"),
        scope: z
          .array(z.enum(["user", "session", "task", "agent"]))
          .optional()
          .describe("Scopes to search"),
        limit: z
          .number()
          .optional()
          .default(5)
          .describe("Max results"),
      }),
      execute: async (input: {
        query: string;
        scope?: MemoryScope[];
        limit?: number;
      }) => {
        const embedding = await embed(harness, input.query);
        const results = await harness.memory().search({
          embedding,
          scope: input.scope,
          limit: input.limit,
        });
        return results.map((r) => ({
          id: r.id,
          content: r.content,
          scope: r.scope,
          score: r.score,
        }));
      },
    }),

    db0_memory_list: tool({
      description: "List all memories, optionally filtered by scope.",
      inputSchema: z.object({
        scope: z
          .enum(["user", "session", "task", "agent"])
          .optional()
          .describe("Filter by scope"),
      }),
      execute: async (input: { scope?: MemoryScope }) => {
        const memories = await harness.memory().list(input.scope);
        return memories.map((m) => ({
          id: m.id,
          content: m.content,
          scope: m.scope,
          status: m.status,
        }));
      },
    }),
  };
}
