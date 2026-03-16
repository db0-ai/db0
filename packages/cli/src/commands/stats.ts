import type { Db0Backend } from "@db0-ai/core";

export async function stats(
  backend: Db0Backend,
  agentId: string,
  opts: { json?: boolean },
): Promise<void> {
  const all = await backend.memoryList(agentId);

  const byScope: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const m of all) {
    byScope[m.scope] = (byScope[m.scope] ?? 0) + 1;
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  }

  const result = { total: all.length, byScope, byStatus };

  if (opts.json) {
    console.log(JSON.stringify(result));
    return;
  }

  console.log(`Total memories: ${result.total}\n`);

  console.log("By scope:");
  for (const [scope, count] of Object.entries(byScope)) {
    console.log(`  ${scope.padEnd(10)} ${count}`);
  }

  console.log("\nBy status:");
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status.padEnd(10)} ${count}`);
  }
}
