export type MemoryScope = "user" | "agent" | "session" | "task";

export interface MemoryFrontmatter {
  id: string;
  scope: MemoryScope;
  tags?: string[];
  created: string;
  supersedes?: string;
  "related-to"?: string[];
  expires?: string;
}

export interface MemoryFile {
  /** Relative path from memory dir, e.g. "user/language-prefs.md" */
  path: string;
  frontmatter: MemoryFrontmatter;
  content: string;
}

export interface RememberResult {
  action: "created" | "superseded" | "related";
  file: string;
  superseded?: { file: string; content: string };
  relatedTo?: string;
}

export interface SearchResult {
  file: string;
  content: string;
  scope: MemoryScope;
  score: number;
  age: string;
  stalenessCaveat: string | null;
}

export interface ConsolidateResult {
  merged: number;
  archived: number;
  expired: number;
}
