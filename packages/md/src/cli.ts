#!/usr/bin/env node
import { resolve } from "node:path";
import { MemoryStore } from "./memory-store.js";
import type { MemoryScope } from "./types.js";

// ── Arg parsing ───────────────────────────────────────────────────

interface ParsedArgs {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // strip node + script
  const command = args[0] && !args[0].startsWith("--") ? args[0] : null;
  const rest = command ? args.slice(1) : args;

  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: string | boolean | undefined, fallback: number): number {
  const s = str(v);
  if (!s) return fallback;
  const n = Number(s);
  return isNaN(n) ? fallback : n;
}

// ── Help ──────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`mdcli — markdown-based memory store for AI agents

Commands:
  remember <fact> [options]     Store a new memory
  search <query> [options]      Search memories by semantic similarity
  pack [query] [options]        Output memories as context block (pipe-friendly)
  consolidate [options]         Clean up superseded, expired, and duplicate memories
  index [options]               Regenerate MEMORIES.md index file

Options:
  --dir <path>                  Memory directory (default: ./memories)
  --scope <scope>               Scope: user | agent | session | task
  --tags <a,b,c>                Comma-separated tags (remember only)
  --limit <n>                   Max results (search, default: 10)
  --budget <n>                  Token budget (pack, default: 4000)
  --quiet                       Suppress output (consolidate only)

Examples:
  mdcli remember "User prefers dark mode" --scope user --dir ./memories
  mdcli search "UI preferences" --limit 5 --dir ./memories
  mdcli pack "language preferences" --budget 2000 --dir ./memories
  mdcli consolidate --dir ./memories
  mdcli index --dir ./memories
`);
}

// ── Output helpers ────────────────────────────────────────────────

function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 3) + "...";
}

function padEnd(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

// ── Commands ──────────────────────────────────────────────────────

async function cmdRemember(
  store: MemoryStore,
  positionals: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const fact = positionals.join(" ").trim();
  if (!fact) {
    console.error("Error: <fact> is required for 'remember'");
    process.exit(1);
  }

  const scopeStr = str(flags["scope"]) ?? "user";
  const validScopes: MemoryScope[] = ["user", "agent", "session", "task"];
  if (!validScopes.includes(scopeStr as MemoryScope)) {
    console.error(`Error: --scope must be one of: ${validScopes.join(", ")}`);
    process.exit(1);
  }
  const scope = scopeStr as MemoryScope;

  const tagsStr = str(flags["tags"]);
  const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : undefined;

  const result = await store.remember(fact, { scope, tags });

  if (result.action === "created") {
    console.log(`Created: ${result.file}`);
    console.log(`Content: ${fact}`);
  } else if (result.action === "superseded") {
    console.log(`Superseded: ${result.file}`);
    console.log(`  Old (${result.superseded!.file}): ${result.superseded!.content}`);
    console.log(`  New: ${fact}`);
  } else if (result.action === "related") {
    console.log(`Related: ${result.file}`);
    console.log(`  Related to: ${result.relatedTo}`);
    console.log(`  Content: ${fact}`);
  }
}

async function cmdSearch(
  store: MemoryStore,
  positionals: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const query = positionals.join(" ").trim();
  if (!query) {
    console.error("Error: <query> is required for 'search'");
    process.exit(1);
  }

  const limit = num(flags["limit"], 10);
  const scopeStr = str(flags["scope"]);
  const scope = scopeStr
    ? (scopeStr.split(",").map((s) => s.trim()) as MemoryScope[])
    : undefined;

  const results = await store.search(query, { limit, scope });

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  // Table header
  const scoreW = 6;
  const scopeW = 8;
  const previewW = 80;
  const ageW = 12;

  const header =
    padEnd("Score", scoreW) +
    "  " +
    padEnd("Scope", scopeW) +
    "  " +
    padEnd("Content", previewW) +
    "  " +
    padEnd("Age", ageW) +
    "  File";
  const divider = "-".repeat(header.length);

  console.log(header);
  console.log(divider);

  for (const r of results) {
    const score = r.score.toFixed(3);
    const preview = truncate(r.content.replace(/\n/g, " "), previewW);
    const age = r.stalenessCaveat ? `${r.age} ⚠` : r.age;
    console.log(
      padEnd(score, scoreW) +
        "  " +
        padEnd(r.scope, scopeW) +
        "  " +
        padEnd(preview, previewW) +
        "  " +
        padEnd(age, ageW) +
        "  " +
        r.file,
    );
  }
}

async function cmdPack(
  store: MemoryStore,
  positionals: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const query = positionals.join(" ").trim() || undefined;
  const tokenBudget = num(flags["budget"], 4000);
  const scopeStr = str(flags["scope"]);
  const scope = scopeStr
    ? (scopeStr.split(",").map((s) => s.trim()) as MemoryScope[])
    : undefined;

  const output = await store.pack({ query, tokenBudget, scope });
  process.stdout.write(output);
}

async function cmdConsolidate(
  store: MemoryStore,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const quiet = flags["quiet"] === true;
  const result = await store.consolidate();
  if (!quiet) {
    console.log(
      `Consolidation complete: merged=${result.merged}, archived=${result.archived}, expired=${result.expired}`,
    );
  }
}

async function cmdIndex(store: MemoryStore): Promise<void> {
  await store.generateIndex();
  console.log("MEMORIES.md regenerated.");
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv);

  if (!command || command === "help" || flags["help"]) {
    printHelp();
    return;
  }

  const dirFlag = str(flags["dir"]) ?? "./memories";
  const dir = resolve(process.cwd(), dirFlag);

  const store = new MemoryStore({ dir });

  switch (command) {
    case "remember":
      await cmdRemember(store, positionals, flags);
      break;
    case "search":
      await cmdSearch(store, positionals, flags);
      break;
    case "pack":
      await cmdPack(store, positionals, flags);
      break;
    case "consolidate":
      await cmdConsolidate(store, flags);
      break;
    case "index":
      await cmdIndex(store);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'mdcli' with no arguments for help.");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
