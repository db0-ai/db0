import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { getHarness } from "@/lib/db0";
import { saveChat } from "@/lib/chat-store";
import { saveMemoryContext } from "@/lib/memory-context";

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

  // Save which memories were used — frontend will fetch this
  saveMemoryContext(chatId, {
    count: ctx.count,
    estimatedTokens: ctx.estimatedTokens,
    text: ctx.text,
    memories: ctx.memories.map((m) => ({
      id: m.id,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      scope: m.scope,
      score: m.score,
    })),
  });

  const systemPrompt = ctx.count > 0
    ? `You are a helpful assistant with memory of past conversations.\n\nRelevant context from previous conversations:\n${ctx.text}`
    : "You are a helpful assistant with memory of past conversations.";

  const result = streamText({
    model: openai("gpt-5.4-mini"),
    system: systemPrompt,
    messages,
    async onFinish({ text }) {
      // Save chat messages
      const allMessages = [
        ...messages.map((m: { role: string; content: string }) => ({
          id: crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { id: crypto.randomUUID(), role: "assistant" as const, content: text },
      ];
      saveChat(chatId, allMessages);

      // Extract durable facts for future sessions
      const extraction = harness.extraction();
      const userFacts = await extraction.extract(lastUserMessage);
      for (const fact of userFacts) {
        await harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: fact.tags,
        });
      }

      const assistantFacts = await extraction.extract(text);
      for (const fact of assistantFacts) {
        await harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: fact.tags,
        });
      }
    },
  });

  return result.toTextStreamResponse();
}
