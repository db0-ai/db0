import { writeFileSync } from "node:fs";
import type { Db0Backend, MemoryScope } from "@db0-ai/core";

export async function exportMemories(
  backend: Db0Backend,
  agentId: string,
  opts: { scope?: string; output?: string; includeEmbeddings?: boolean },
): Promise<void> {
  const scope = opts.scope as MemoryScope | undefined;
  const memories = await backend.memoryList(agentId, scope);

  const lines: string[] = [];
  for (const m of memories) {
    if (opts.includeEmbeddings) {
      lines.push(JSON.stringify(m));
    } else {
      const { embedding, ...rest } = m;
      lines.push(JSON.stringify(rest));
    }
  }

  const content = lines.join("\n") + (lines.length > 0 ? "\n" : "");

  if (opts.output) {
    writeFileSync(opts.output, content, "utf-8");
    console.log(`Exported ${memories.length} memories to ${opts.output}`);
  } else {
    process.stdout.write(content);
  }
}
