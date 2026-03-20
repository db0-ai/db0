#!/usr/bin/env node

/**
 * CLI installer for the db0 Pi extension.
 *
 * Usage:
 *   npx @db0-ai/pi init        # install extension into ~/.pi/agent/extensions/db0/
 *   npx @db0-ai/pi uninstall    # remove extension and optionally the database
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const PI_HOME = process.env.PI_HOME ?? join(homedir(), ".pi", "agent");
const EXT_DIR = join(PI_HOME, "extensions", "db0");
const DB_PATH = join(PI_HOME, "db0.sqlite");

const ENTRY_POINT = `import { createDb0PiExtension } from "@db0-ai/pi";

export default async function register(pi) {
  const ext = await createDb0PiExtension();
  ext.register(pi);
}
`;

function init() {
  console.log(`\n${BOLD}  db0 — Pi extension installer${RESET}\n`);

  // Create extension directory
  mkdirSync(EXT_DIR, { recursive: true });
  console.log(`  ${GREEN}✓${RESET} Created ${DIM}${EXT_DIR}${RESET}`);

  // Initialize package.json if needed
  const pkgPath = join(EXT_DIR, "package.json");
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      JSON.stringify(
        { name: "db0-pi-extension", type: "module", private: true, dependencies: {} },
        null,
        2,
      ),
    );
  }

  // Install @db0-ai/pi
  console.log(`  ${DIM}Installing @db0-ai/pi...${RESET}`);
  execSync("npm install @db0-ai/pi", { cwd: EXT_DIR, stdio: "pipe" });
  console.log(`  ${GREEN}✓${RESET} Installed @db0-ai/pi`);

  // Write entry point
  writeFileSync(join(EXT_DIR, "index.mjs"), ENTRY_POINT);
  console.log(`  ${GREEN}✓${RESET} Created ${DIM}index.mjs${RESET}`);

  console.log(`\n  ${GREEN}${BOLD}Done!${RESET} Restart Pi to activate.`);
  console.log(`  ${DIM}Memory will be stored at ${DB_PATH}${RESET}`);
  console.log(`  ${DIM}Inspect with: npx @db0-ai/inspector --db ${DB_PATH}${RESET}\n`);
}

function uninstall() {
  console.log(`\n${BOLD}  db0 — Pi extension uninstaller${RESET}\n`);

  if (existsSync(EXT_DIR)) {
    rmSync(EXT_DIR, { recursive: true, force: true });
    console.log(`  ${GREEN}✓${RESET} Removed extension directory`);
  } else {
    console.log(`  ${DIM}Extension directory not found — already uninstalled${RESET}`);
  }

  const keepData = process.argv.includes("--keep-data");
  if (!keepData && existsSync(DB_PATH)) {
    rmSync(DB_PATH);
    console.log(`  ${GREEN}✓${RESET} Removed database`);
  } else if (keepData) {
    console.log(`  ${DIM}Kept database at ${DB_PATH}${RESET}`);
  }

  console.log(`\n  ${GREEN}${BOLD}Done!${RESET} Restart Pi.\n`);
}

const command = process.argv[2];

if (command === "init") {
  init();
} else if (command === "uninstall") {
  uninstall();
} else {
  console.log(`
  Usage:
    npx @db0-ai/pi init                # install db0 extension for Pi
    npx @db0-ai/pi uninstall            # remove extension and database
    npx @db0-ai/pi uninstall --keep-data # remove extension, keep database
  `);
}
