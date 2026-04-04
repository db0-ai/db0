import type { MemoryFrontmatter } from "./types.js";

/**
 * Minimal YAML frontmatter parser. No dependencies.
 * Handles the subset we need: scalars, arrays, quoted strings.
 */
export function parseMarkdown(raw: string): {
  frontmatter: Partial<MemoryFrontmatter>;
  content: string;
} {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, content: raw.trim() };
  }

  const fmBlock = fmMatch[1];
  const content = fmMatch[2].trim();
  const frontmatter: Record<string, unknown> = {};

  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Remove surrounding quotes
    if (
      typeof value === "string" &&
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = value.slice(1, -1);
    }

    // Parse inline arrays: [a, b, c]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (key) frontmatter[key] = value;
  }

  return { frontmatter: frontmatter as Partial<MemoryFrontmatter>, content };
}

/**
 * Serialize frontmatter + content into a markdown string.
 */
export function serializeMarkdown(
  frontmatter: Partial<MemoryFrontmatter>,
  content: string,
): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(content);

  return lines.join("\n") + "\n";
}
