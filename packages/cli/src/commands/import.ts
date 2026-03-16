import { readFileSync } from "node:fs";
import { defaultEmbeddingFn, type Db0Backend, type MemoryScope } from "@db0-ai/core";

export async function importMemories(
  backend: Db0Backend,
  agentId: string,
  opts: { input?: string; sessionId?: string },
): Promise<void> {
  const raw = opts.input
    ? readFileSync(opts.input, "utf-8")
    : readFileSync(0, "utf-8"); // stdin

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const sessionId = opts.sessionId ?? `import-${Date.now()}`;

  let imported = 0;
  for (const line of lines) {
    const record = JSON.parse(line);

    const content = record.content;
    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const embedding = await defaultEmbeddingFn(contentStr);

    await backend.memoryWrite(agentId, sessionId, record.userId ?? null, {
      content,
      scope: (record.scope as MemoryScope) ?? "user",
      embedding,
      tags: record.tags ?? [],
      metadata: {
        ...(record.metadata ?? {}),
        importedAt: new Date().toISOString(),
        importedFrom: opts.input ?? "stdin",
      },
    });
    imported++;
  }

  console.error(`Imported ${imported} memories for agent "${agentId}"`);
}
