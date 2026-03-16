import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const INSPECTOR_HTML = readFileSync(
  join(__dirname, "..", "src", "ui.html"),
  "utf-8",
);
