import { defaultEmbeddingFn, type Db0Backend, type MemoryScope } from "@db0-ai/core";

export async function search(
  backend: Db0Backend,
  agentId: string,
  query: string,
  opts: { scope?: string; limit?: number; scoring?: string; json?: boolean },
): Promise<void> {
  const embedding = await defaultEmbeddingFn(query);
  const scoring = (opts.scoring ?? "rrf") as "similarity" | "hybrid" | "rrf";
  const scope = opts.scope as MemoryScope | undefined;

  const results = await backend.memorySearch(agentId, null, null, {
    embedding,
    queryText: query,
    scope: scope ? [scope] : undefined,
    scoring,
    limit: opts.limit ?? 10,
    minScore: 0,
  });

  if (opts.json) {
    for (const r of results) {
      const { embedding: _e, ...rest } = r;
      console.log(JSON.stringify(rest));
    }
    return;
  }

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log(`Found ${results.length} results:\n`);
  for (const r of results) {
    const content = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    const truncated = content.length > 70 ? content.slice(0, 67) + "..." : content;
    console.log(`  ${r.score.toFixed(3)}  ${r.id.slice(0, 8)}  [${r.scope.padEnd(7)}]  ${truncated}`);
  }
}
