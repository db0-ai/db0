import { getGlobalHarness } from "@/lib/db0";

export const runtime = "nodejs";

export async function GET() {
  const harness = await getGlobalHarness();
  const memories = await harness.memory().list();

  return Response.json(
    memories.map((m) => ({
      id: m.id,
      content: m.content,
      scope: m.scope,
      status: m.status,
      tags: m.tags,
      summary: m.summary,
      createdAt: m.createdAt,
      accessCount: m.accessCount,
    })),
  );
}
