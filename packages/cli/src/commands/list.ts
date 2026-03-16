import type { Db0Backend, MemoryScope } from "@db0-ai/core";

export async function list(
  backend: Db0Backend,
  agentId: string,
  opts: { scope?: string; limit?: number; json?: boolean },
): Promise<void> {
  const scope = opts.scope as MemoryScope | undefined;
  let memories = await backend.memoryList(agentId, scope);

  if (opts.limit) {
    memories = memories.slice(0, opts.limit);
  }

  if (opts.json) {
    for (const m of memories) {
      const { embedding, ...rest } = m;
      console.log(JSON.stringify(rest));
    }
    return;
  }

  if (memories.length === 0) {
    console.log("No memories found.");
    return;
  }

  console.log(`Found ${memories.length} memories:\n`);
  for (const m of memories) {
    const display = m.summary ?? (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    const truncated = display.length > 80 ? display.slice(0, 77) + "..." : display;
    console.log(`  ${m.id.slice(0, 8)}  [${m.scope.padEnd(7)}]  ${m.status.padEnd(10)}  ${truncated}`);
  }
}
