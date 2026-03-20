/**
 * db0 memory middleware for the Vercel AI SDK.
 *
 * Wraps any language model to:
 * 1. Before each call: pack relevant memories into the system prompt
 * 2. After each call: extract facts from user messages and assistant responses
 *
 * Usage:
 *   import { wrapLanguageModel } from "ai";
 *   import { db0MemoryMiddleware } from "@db0-ai/ai-sdk";
 *
 *   const model = wrapLanguageModel({
 *     model: anthropic("claude-sonnet-4-20250514"),
 *     middleware: db0MemoryMiddleware({ harness }),
 *   });
 */

import type {
  LanguageModelV3Middleware,
  LanguageModelV3CallOptions,
  LanguageModelV3Message,
} from "@ai-sdk/provider";
import type { Harness } from "@db0-ai/core";

export interface Db0MiddlewareOptions {
  /** db0 harness instance (must have embeddingFn configured for semantic search) */
  harness: Harness;
  /** Token budget for packed memories in the system prompt. Default: 1500 */
  tokenBudget?: number;
  /** Whether to extract facts from user and assistant messages. Default: true */
  extractOnResponse?: boolean;
}

/**
 * Extract the last user message text from the V3 prompt format.
 */
function getLastUserMessageText(
  prompt: LanguageModelV3Message[],
): string | null {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i];
    if (msg.role === "user") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return null;
}

/**
 * Extract all text from assistant content parts in a generate result.
 */
function getAssistantText(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
}

/**
 * Inject a system message at the beginning of the prompt.
 * If there's already a system message, append to it.
 */
function injectSystemContext(
  params: LanguageModelV3CallOptions,
  contextText: string,
): LanguageModelV3CallOptions {
  const prompt = [...params.prompt];

  const systemIdx = prompt.findIndex((m) => m.role === "system");
  if (systemIdx >= 0) {
    const existing = prompt[systemIdx] as { role: "system"; content: string };
    prompt[systemIdx] = {
      role: "system" as const,
      content:
        existing.content +
        "\n\nRelevant memories from previous conversations:\n" +
        contextText,
    };
  } else {
    prompt.unshift({
      role: "system" as const,
      content:
        "Relevant memories from previous conversations:\n" + contextText,
    });
  }

  return { ...params, prompt };
}

export function db0MemoryMiddleware(
  options: Db0MiddlewareOptions,
): LanguageModelV3Middleware {
  const {
    harness,
    tokenBudget = 1500,
    extractOnResponse = true,
  } = options;

  return {
    specificationVersion: "v3",

    transformParams: async ({ params }) => {
      const userText = getLastUserMessageText(params.prompt);
      if (!userText) return params;

      // Pack relevant memories for this query
      const ctx = await harness.context().pack(userText, { tokenBudget });
      if (ctx.count === 0) return params;

      // Also extract facts from the user message now (before LLM call)
      if (extractOnResponse) {
        const extraction = harness.extraction();
        const facts = await extraction.extract(userText);
        for (const fact of facts) {
          await harness.context().ingest(fact.content, {
            scope: fact.scope,
            tags: fact.tags,
          });
        }
      }

      return injectSystemContext(params, ctx.text);
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();

      // Extract facts from the assistant response
      if (extractOnResponse && result.content) {
        const assistantText = getAssistantText(
          result.content as Array<{ type: string; text?: string }>,
        );
        if (assistantText) {
          const extraction = harness.extraction();
          const facts = await extraction.extract(assistantText);
          for (const fact of facts) {
            await harness.context().ingest(fact.content, {
              scope: fact.scope,
              tags: fact.tags,
            });
          }
        }
      }

      return result;
    },
  };
}
