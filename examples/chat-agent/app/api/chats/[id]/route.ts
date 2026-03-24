import { getChat } from "@/lib/chat-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return Response.json({ messages: [] });
  return Response.json(chat);
}
