import { listChats } from "@/lib/chat-store";

export async function GET() {
  return Response.json(listChats());
}
