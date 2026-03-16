#!/usr/bin/env node
/**
 * Launch the db0 memory inspector web UI.
 *
 * Usage:
 *   node scripts/inspect-web.mjs                     # auto-detect from OpenClaw config
 *   node scripts/inspect-web.mjs --db path/to.sqlite  # explicit db path
 *   node scripts/inspect-web.mjs --agent my-agent     # filter by agent
 *   node scripts/inspect-web.mjs --port 8080          # custom port
 *   node scripts/inspect-web.mjs --host 127.0.0.1     # localhost only
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createInspector } from "@db0-ai/inspector";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

// --- CLI args ---
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

// --- Auto-detect OpenClaw ---
function findOpenClawDir() {
  const candidates = [
    process.env.OPENCLAW_HOME,
    join(homedir(), ".openclaw"),
    join(homedir(), ".config", "openclaw"),
  ].filter(Boolean);
  return candidates.find((d) => existsSync(d));
}

function readOpenClawConfig(dir) {
  const configPath = join(dir, "openclaw.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

function detectAgentIds(dir) {
  const agentsDir = join(dir, "agents");
  if (!existsSync(agentsDir)) return [];
  try {
    return readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function findDb(dir) {
  // Check common locations for db0.sqlite
  const candidates = [
    join(dir, "db0.sqlite"),
    join(dir, "memory", "db0.sqlite"),
  ];
  return candidates.find((p) => existsSync(p));
}

// --- Resolve config ---
const openclawDir = findOpenClawDir();
const openclawConfig = openclawDir ? readOpenClawConfig(openclawDir) : null;
const agents = openclawDir ? detectAgentIds(openclawDir) : [];

const dbPath = flag("db") || (openclawDir && findDb(openclawDir));
const agentId = flag("agent") || (agents.length === 1 ? agents[0] : "main");
const host = flag("host") || "0.0.0.0";
const port = Number(flag("port") || 6460);

if (!dbPath || !existsSync(dbPath)) {
  console.error("Could not find db0.sqlite.");
  console.error("");
  if (openclawDir) {
    console.error(`  OpenClaw dir: ${openclawDir}`);
    console.error(`  Searched:     ${openclawDir}/db0.sqlite`);
  } else {
    console.error("  No OpenClaw directory found (~/.openclaw or OPENCLAW_HOME)");
  }
  console.error("");
  console.error("  Usage: node scripts/inspect-web.mjs --db /path/to/db0.sqlite");
  process.exit(1);
}

// --- Start ---
const backend = await createSqliteBackend({ dbPath });
const inspector = createInspector({ backend, host, port, agentId });
const { url } = await inspector.start();

console.log("");
console.log("  db0 Memory Inspector");
console.log("");
console.log(`  URL:      ${url}`);
console.log(`  Database: ${dbPath}`);
console.log(`  Agent:    ${agentId}`);
if (agents.length > 1) {
  console.log(`  Available agents: ${agents.join(", ")}`);
  console.log(`  Switch with: --agent <name>`);
}
if (openclawConfig) {
  const ceSlot = openclawConfig?.plugins?.slots?.contextEngine;
  const memSlot = openclawConfig?.plugins?.slots?.memory;
  if (ceSlot) console.log(`  Context engine: ${ceSlot}`);
  if (memSlot) console.log(`  Memory slot:    ${memSlot}`);
}
console.log("");
console.log("  Press Ctrl+C to stop.");
console.log("");
