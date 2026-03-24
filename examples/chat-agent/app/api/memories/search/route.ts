import { getHarness } from "@/lib/db0";
import { saveMemoryContext } from "@/lib/memory-context";

export const runtime = "nodejs";

/**
 * Search memory before the chat request — returns which memories
 * will be used for context. Called by the frontend to show the
 * "thinking" process before the LLM response streams.
 */
export async function POST(req: Request) {
  const { query, chatId, userId } = await req.json();

  const harness = await getHarness({
    sessionId: chatId ?? "default",
    userId: userId ?? "default",
  });

  const ctx = await harness.context().pack(query, { tokenBudget: 2000 });

  const memories = ctx.memories.map((m) => ({
    id: m.id,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    scope: m.scope,
    score: m.score,
  }));

  // Save for later retrieval too
  saveMemoryContext(chatId, {
    count: ctx.count,
    estimatedTokens: ctx.estimatedTokens,
    text: ctx.text,
    memories,
  });

  return Response.json({
    count: ctx.count,
    estimatedTokens: ctx.estimatedTokens,
    memories,
  });
}
