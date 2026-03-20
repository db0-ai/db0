/**
 * db0 chat agent example
 *
 * A terminal chatbot that remembers across sessions. Demonstrates:
 * - Scoped memory (user-scope facts persist forever)
 * - Automatic fact extraction (rules-based, zero LLM calls)
 * - Context packing (assembles relevant memories for the LLM)
 * - Memory superseding (corrects stale facts)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx examples/chat-agent/index.ts
 *
 * Memory persists in ./chat-agent.sqlite between runs.
 */

import Anthropic from "@anthropic-ai/sdk";
import * as readline from "node:readline";
import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY to run this example.");
    process.exit(1);
  }

  const anthropic = new Anthropic();

  // Persistent SQLite storage — memory survives across sessions
  const backend = await createSqliteBackend({ dbPath: "./chat-agent.sqlite" });
  const harness = db0.harness({
    agentId: "chat-agent",
    sessionId: `session-${Date.now()}`,
    userId: "user",
    backend,
    embeddingFn: defaultEmbeddingFn,
    profile: PROFILE_CONVERSATIONAL,
  });

  const extraction = harness.extraction();

  // Show what we remember from previous sessions
  const existing = await harness.memory().list("user");
  if (existing.length > 0) {
    console.log(`${DIM}Memories from previous sessions (${existing.length}):${RESET}`);
    for (const m of existing.slice(0, 5)) {
      console.log(`${DIM}  - ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}${RESET}`);
    }
    if (existing.length > 5) {
      console.log(`${DIM}  ... and ${existing.length - 5} more${RESET}`);
    }
    console.log();
  }

  console.log("Chat with an agent that remembers. Type 'quit' to exit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  const prompt = () => {
    rl.question(`${CYAN}you:${RESET} `, async (input) => {
      const text = input.trim();
      if (!text || text === "quit" || text === "exit") {
        console.log(`\n${DIM}Goodbye. Your memories are saved.${RESET}`);
        harness.close();
        rl.close();
        return;
      }

      messages.push({ role: "user", content: text });

      // Pack relevant memories as context for the LLM
      const ctx = await harness.context().pack(text, { tokenBudget: 1500 });

      const systemPrompt = [
        "You are a helpful assistant with persistent memory.",
        "When you learn something about the user (preferences, name, facts),",
        "mention it naturally. Be concise.",
        ctx.count > 0
          ? `\nHere are relevant memories from previous conversations:\n${ctx.text}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      if (ctx.count > 0) {
        console.log(`${DIM}(${ctx.count} memories loaded, ~${ctx.estimatedTokens} tokens)${RESET}`);
      }

      // Call the LLM
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        system: systemPrompt,
        messages,
      });

      const assistantText =
        response.content[0].type === "text" ? response.content[0].text : "";
      messages.push({ role: "assistant", content: assistantText });

      console.log(`\n${assistantText}\n`);

      // Extract facts from this turn and store them
      const userFacts = extraction.extract(text);
      const assistantFacts = extraction.extract(assistantText);
      const allFacts = [...userFacts, ...assistantFacts];

      for (const fact of allFacts) {
        await harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: fact.tags,
        });
      }

      if (allFacts.length > 0) {
        console.log(
          `${DIM}(extracted ${allFacts.length} fact${allFacts.length > 1 ? "s" : ""})${RESET}`,
        );
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
