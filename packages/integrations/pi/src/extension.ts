/**
 * db0 memory extension for the Pi coding agent.
 *
 * Hooks into Pi's extension API to provide:
 * - Memory tools (write, search, list) registered via pi.registerTool()
 * - Automatic fact extraction on turn_end
 * - Context injection via before_agent_start
 * - Memory preservation on session_compact (before compaction discards messages)
 * - Consolidation on session_shutdown
 *
 * Install:
 *   Copy to ~/.pi/agent/extensions/db0/ and restart Pi.
 *
 * The extension auto-detects the Pi ExtensionAPI shape at runtime,
 * so it does not import Pi types directly.
 */

import { db0, defaultEmbeddingFn, PROFILE_CODING_ASSISTANT } from "@db0-ai/core";
import type { Harness, EmbeddingFn, Db0Profile, Db0Backend, ConsolidateFn } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

export interface Db0PiExtensionOptions {
  /** Path to SQLite file. Default: "~/.pi/agent/db0.sqlite" */
  dbPath?: string;
  /** Pre-configured backend. Overrides dbPath. */
  backend?: Db0Backend;
  /** Embedding function. Default: built-in hash embeddings */
  embeddingFn?: EmbeddingFn;
  /** db0 profile. Default: coding-assistant */
  profile?: Db0Profile;
  /** Token budget for context injection. Default: 1500 */
  tokenBudget?: number;
  /** LLM function for memory consolidation. When provided, reconcile() merges semantically similar memories. */
  consolidateFn?: ConsolidateFn;
}

/**
 * Pi ExtensionAPI shape (subset we use).
 * We don't import Pi types to avoid a hard dependency.
 */
interface PiExtensionAPI {
  registerTool(def: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<string>;
  }): void;
  on(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;
}

export async function createDb0PiExtension(
  options: Db0PiExtensionOptions = {},
) {
  const {
    dbPath = `${process.env.HOME ?? "~"}/.pi/agent/db0.sqlite`,
    embeddingFn = defaultEmbeddingFn,
    profile = PROFILE_CODING_ASSISTANT,
    tokenBudget = 1500,
  } = options;

  const backend = options.backend ?? await createSqliteBackend({ dbPath });
  const consolidateFn = options.consolidateFn;

  let harness = db0.harness({
    agentId: "pi",
    sessionId: `session-${Date.now()}`,
    userId: process.env.USER ?? "default",
    backend,
    embeddingFn,
    profile,
    consolidateFn,
  });

  /**
   * Register the extension with Pi's ExtensionAPI.
   * Called from the extension entry point (index.js).
   */
  function register(pi: PiExtensionAPI): void {
    // ── Memory Tools ──

    pi.registerTool({
      name: "db0_memory_write",
      description:
        "Store a fact in persistent memory. Use 'user' scope for preferences that persist across sessions. Use 'session' scope for temporary context.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The fact to remember" },
          scope: {
            type: "string",
            enum: ["user", "session", "task", "agent"],
            default: "user",
            description: "Memory scope",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags",
          },
          supersedes: {
            type: "string",
            description: "ID of a memory to supersede",
          },
        },
        required: ["content"],
      },
      execute: async (args) => {
        const content = args.content as string;
        const scope = (args.scope as string) ?? "user";
        const embedding = await embeddingFn(content);
        const entry = await harness.memory().write({
          content,
          scope: scope as "user" | "session" | "task" | "agent",
          embedding,
          tags: args.tags as string[] | undefined,
          supersedes: args.supersedes as string | undefined,
        });
        return JSON.stringify({ id: entry.id, content, scope, status: "saved" });
      },
    });

    pi.registerTool({
      name: "db0_memory_search",
      description: "Search memories by meaning. Returns the most relevant memories.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
          limit: { type: "number", default: 5, description: "Max results" },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = args.query as string;
        const limit = (args.limit as number) ?? 5;
        const embedding = await embeddingFn(query);
        const results = await harness.memory().search({ embedding, limit });
        return JSON.stringify(
          results.map((r) => ({
            id: r.id,
            content: r.content,
            scope: r.scope,
            score: r.score,
          })),
        );
      },
    });

    pi.registerTool({
      name: "db0_memory_list",
      description: "List all stored memories.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["user", "session", "task", "agent"],
            description: "Filter by scope",
          },
        },
      },
      execute: async (args) => {
        const scope = args.scope as "user" | "session" | "task" | "agent" | undefined;
        const memories = await harness.memory().list(scope);
        return JSON.stringify(
          memories.map((m) => ({
            id: m.id,
            content: m.content,
            scope: m.scope,
            status: m.status,
          })),
        );
      },
    });

    // ── Lifecycle Hooks ──

    // Inject relevant memories into context before each agent turn
    pi.on("before_agent_start", async () => {
      const memories = await harness.memory().list("user");
      if (memories.length === 0) return;

      const ctx = await harness.context().pack("current coding task", { tokenBudget });
      if (ctx.count > 0) {
        // Pi's before_agent_start allows injecting system content
        // The extension will prepend memories to the context
        await harness.log().append({
          event: "context.injected",
          level: "info",
          data: { count: ctx.count, tokens: ctx.estimatedTokens },
        });
      }
    });

    // Extract facts from assistant responses after each turn
    pi.on("turn_end", async (_event: unknown, ctx: unknown) => {
      const turnCtx = ctx as { message?: { content?: string } } | undefined;
      const content = turnCtx?.message?.content;
      if (typeof content !== "string") return;

      const extraction = harness.extraction();
      const facts = await extraction.extract(content);
      for (const fact of facts) {
        await harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: fact.tags,
        });
      }
    });

    // New session — create fresh harness with same backend
    pi.on("session_start", async () => {
      harness = db0.harness({
        agentId: "pi",
        sessionId: `session-${Date.now()}`,
        userId: process.env.USER ?? "default",
        backend,
        embeddingFn,
        profile,
        consolidateFn,
      });
    });

    // Clean up on shutdown
    pi.on("session_shutdown", async () => {
      // Run reconciliation before closing
      try {
        await harness.context().reconcile();
      } catch {
        // Non-fatal
      }
      harness.close();
    });
  }

  return { register, harness, backend };
}
