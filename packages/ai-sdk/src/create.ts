/**
 * Convenience factory for setting up db0 with the Vercel AI SDK.
 *
 * Usage:
 *   import { createDb0 } from "@db0-ai/ai-sdk";
 *
 *   const memory = await createDb0();
 *   // or: const memory = await createDb0({ dbPath: "./my-app.sqlite" });
 *
 *   const model = wrapLanguageModel({
 *     model: anthropic("claude-sonnet-4-20250514"),
 *     middleware: memory.middleware,
 *   });
 *
 *   // Use memory.tools in generateText/streamText
 *   // Use memory.harness for direct access
 *   // Call memory.close() when done
 */

import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import type { Harness, EmbeddingFn, Db0Profile } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { db0MemoryMiddleware } from "./middleware.js";
import type { Db0MiddlewareOptions } from "./middleware.js";
import { db0MemoryTools } from "./tools.js";

export interface CreateDb0Options {
  /** Path to SQLite file. Default: "./db0.sqlite" */
  dbPath?: string;
  /** Agent identifier. Default: "ai-sdk" */
  agentId?: string;
  /** Session identifier. Default: auto-generated */
  sessionId?: string;
  /** User identifier. Default: "default" */
  userId?: string;
  /** Embedding function. Default: built-in hash embeddings */
  embeddingFn?: EmbeddingFn;
  /** db0 profile. Default: conversational */
  profile?: Db0Profile;
  /** Token budget for memory context. Default: 1500 */
  tokenBudget?: number;
  /** Extract facts automatically. Default: true */
  extractOnResponse?: boolean;
}

export interface Db0Instance {
  /** Language model middleware — wraps any model with memory */
  middleware: ReturnType<typeof db0MemoryMiddleware>;
  /** Memory tools for tool-calling agents */
  tools: ReturnType<typeof db0MemoryTools>;
  /** Direct harness access for advanced usage */
  harness: Harness;
  /** Start a new session (new sessionId, same backend and memories) */
  newSession: (sessionId?: string) => Harness;
  /** Clean up */
  close: () => void;
}

export async function createDb0(
  options: CreateDb0Options = {},
): Promise<Db0Instance> {
  const {
    dbPath = "./db0.sqlite",
    agentId = "ai-sdk",
    sessionId = `session-${Date.now()}`,
    userId = "default",
    embeddingFn = defaultEmbeddingFn,
    profile = PROFILE_CONVERSATIONAL,
    tokenBudget = 1500,
    extractOnResponse = true,
  } = options;

  const backend = await createSqliteBackend({ dbPath });

  let harness = db0.harness({
    agentId,
    sessionId,
    userId,
    backend,
    embeddingFn,
    profile,
  });

  const middlewareOpts: Db0MiddlewareOptions = {
    harness,
    tokenBudget,
    extractOnResponse,
  };

  return {
    middleware: db0MemoryMiddleware(middlewareOpts),
    tools: db0MemoryTools({ harness }),
    harness,
    newSession: (newSessionId?: string) => {
      harness = db0.harness({
        agentId,
        sessionId: newSessionId ?? `session-${Date.now()}`,
        userId,
        backend,
        embeddingFn,
        profile,
      });
      // Update the middleware's harness reference
      middlewareOpts.harness = harness;
      return harness;
    },
    close: () => harness.close(),
  };
}
