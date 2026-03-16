#!/usr/bin/env node
/**
 * Inspect db0 SQLite database contents.
 * Usage: node scripts/inspect-db.mjs [path-to-db0.sqlite]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import initSqlJs from "sql.js";

const dbPath = process.argv[2]
  || join(homedir(), ".openclaw", "db0.sqlite");

if (!existsSync(dbPath)) {
  console.error(`File not found: ${dbPath}`);
  process.exit(1);
}

const buf = readFileSync(dbPath);
if (buf.length === 0) {
  console.error(`File is empty (0 bytes): ${dbPath}`);
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(buf);

const tables = ["db0_memory", "db0_state", "db0_log", "db0_memory_edges"];

for (const table of tables) {
  const count = db.exec(`SELECT COUNT(*) FROM ${table}`);
  const n = count[0]?.values[0]?.[0] ?? 0;
  console.log(`\n=== ${table} (${n} rows) ===`);

  if (n === 0) continue;

  if (table === "db0_memory") {
    const rows = db.exec(
      `SELECT id, agent_id, scope, content, tags, status, version, created_at FROM ${table} ORDER BY created_at DESC`
    );
    for (const row of rows[0].values) {
      const [id, agentId, scope, content, tags, status, version, createdAt] = row;
      console.log(`  [${scope}] ${content}`);
      console.log(`    id=${id} agent=${agentId} status=${status} v=${version} tags=${tags} at=${createdAt}`);
    }
  } else if (table === "db0_state") {
    const rows = db.exec(`SELECT id, agent_id, session_id, step, label, created_at FROM ${table} ORDER BY created_at DESC`);
    for (const row of rows[0].values) {
      const [id, agentId, sessionId, step, label, createdAt] = row;
      console.log(`  step=${step} label=${label} agent=${agentId} session=${sessionId} at=${createdAt}`);
    }
  } else if (table === "db0_log") {
    const rows = db.exec(`SELECT event, level, data, created_at FROM ${table} ORDER BY created_at DESC LIMIT 20`);
    for (const row of rows[0].values) {
      const [event, level, data, createdAt] = row;
      console.log(`  [${level}] ${event} ${data} at=${createdAt}`);
    }
  } else if (table === "db0_memory_edges") {
    const rows = db.exec(`SELECT * FROM ${table}`);
    for (const row of rows[0].values) {
      console.log(`  ${JSON.stringify(row)}`);
    }
  }
}

db.close();
