import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { getHarness } from "@/lib/db0";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messages, chatId, userId } = await req.json();

  const harness = await getHarness({
    sessionId: chatId ?? "default",
    userId: userId ?? "default",
  });

  // Pack relevant memories from past sessions into the system prompt
  const lastUserMessage = messages.at(-1)?.content ?? "";
  const ctx = await harness.context().pack(lastUserMessage, {
    tokenBudget: 2000,
  });

  const systemPrompt = ctx.count > 0
    ? `You are a helpful assistant with memory of past conversations.\n\nRelevant context from previous conversations:\n${ctx.text}`
    : "You are a helpful assistant with memory of past conversations.";

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages,
    async onFinish({ text }) {
      // Extract durable facts from this turn for future sessions
      // User message
      const extraction = harness.extraction();
      const userFacts = await extraction.extract(lastUserMessage);
      for (const fact of userFacts) {
        await harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: fact.tags,
        });
      }

      // Assistant response
      const assistantFacts = await extraction.extract(text);
      for (const fact of assistantFacts) {
        await harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: fact.tags,
        });
      }
    },
  });

  return result.toDataStreamResponse();
}
