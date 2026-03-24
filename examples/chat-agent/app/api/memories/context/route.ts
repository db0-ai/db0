import { getMemoryContext } from "@/lib/memory-context";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get("chatId");
  if (!chatId) return Response.json(null);

  return Response.json(getMemoryContext(chatId));
}
