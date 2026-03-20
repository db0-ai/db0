/**
 * db0 memory tools for LangChain.js agents.
 *
 * Usage:
 *   import { db0MemoryTools } from "@db0-ai/langchain";
 *
 *   const tools = db0MemoryTools({ harness });
 *   const agent = createReactAgent({ llm, tools });
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Harness } from "@db0-ai/core";
import { defaultEmbeddingFn } from "@db0-ai/core";
import type { MemoryScope } from "@db0-ai/core";

export interface Db0ToolsOptions {
  /** db0 harness instance */
  harness: Harness;
}

async function embed(harness: Harness, text: string): Promise<Float32Array> {
  const fn = (harness as any).config?.embeddingFn ?? defaultEmbeddingFn;
  return fn(text);
}

export function db0MemoryTools(options: Db0ToolsOptions) {
  const { harness } = options;

  const memoryWrite = tool(
    async (input: { content: string; scope: MemoryScope; tags?: string[]; supersedes?: string }) => {
      const embedding = await embed(harness, input.content);
      const entry = await harness.memory().write({
        content: input.content,
        scope: input.scope,
        embedding,
        tags: input.tags,
        supersedes: input.supersedes,
      });
      return JSON.stringify({ id: entry.id, content: input.content, scope: input.scope, status: "saved" });
    },
    {
      name: "db0_memory_write",
      description:
        "Store a fact in persistent memory. Use 'user' scope for preferences and personal info that persist across sessions. Use 'session' scope for temporary context.",
      schema: z.object({
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
    },
  );

  const memorySearch = tool(
    async (input: { query: string; scope?: MemoryScope[]; limit?: number }) => {
      const embedding = await embed(harness, input.query);
      const results = await harness.memory().search({
        embedding,
        scope: input.scope,
        limit: input.limit ?? 5,
      });
      return JSON.stringify(
        results.map((r) => ({
          id: r.id,
          content: r.content,
          scope: r.scope,
          score: r.score,
        })),
      );
    },
    {
      name: "db0_memory_search",
      description: "Search memories by meaning. Returns the most relevant memories for a query.",
      schema: z.object({
        query: z.string().describe("What to search for"),
        scope: z
          .array(z.enum(["user", "session", "task", "agent"]))
          .optional()
          .describe("Scopes to search"),
        limit: z.number().optional().default(5).describe("Max results"),
      }),
    },
  );

  const memoryList = tool(
    async (input: { scope?: MemoryScope }) => {
      const memories = await harness.memory().list(input.scope);
      return JSON.stringify(
        memories.map((m) => ({
          id: m.id,
          content: m.content,
          scope: m.scope,
          status: m.status,
        })),
      );
    },
    {
      name: "db0_memory_list",
      description: "List all memories, optionally filtered by scope.",
      schema: z.object({
        scope: z
          .enum(["user", "session", "task", "agent"])
          .optional()
          .describe("Filter by scope"),
      }),
    },
  );

  return [memoryWrite, memorySearch, memoryList];
}
