import {
  hashEmbed,
  cosineSimilarity,
  generateId,
  memoryAge,
} from "@db0-ai/core";
import { LocalContentStore } from "./content-store.js";
import type { ContentStore } from "./content-store.js";
import { parseMarkdown, serializeMarkdown } from "./markdown.js";
import type {
  MemoryScope,
  MemoryFrontmatter,
  MemoryFile,
  RememberResult,
  SearchResult,
  ConsolidateResult,
} from "./types.js";

// ── Option types ──────────────────────────────────────────────────

export interface MemoryStoreOpts {
  dir: string;
  contentStore?: ContentStore;
  highThreshold?: number;
  mediumThreshold?: number;
}

export interface RememberOpts {
  scope: MemoryScope;
  tags?: string[];
  expires?: string;
}

export interface SearchOpts {
  limit?: number;
  scope?: MemoryScope[];
}

export interface PackOpts {
  query?: string;
  tokenBudget?: number;
  scope?: MemoryScope[];
}

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_HIGH_THRESHOLD = 0.65;
const DEFAULT_MEDIUM_THRESHOLD = 0.4;
const DEFAULT_TOKEN_BUDGET = 4000;
const CHARS_PER_TOKEN = 4;
const SCOPE_PRIORITY: Record<MemoryScope, number> = {
  task: 0,
  session: 1,
  agent: 2,
  user: 3,
};
const SESSION_TASK_EXPIRE_HOURS = 24;

// ── MemoryStore ───────────────────────────────────────────────────

export class MemoryStore {
  private store: ContentStore;
  private dir: string;
  private highThreshold: number;
  private mediumThreshold: number;

  constructor(opts: MemoryStoreOpts) {
    this.dir = opts.dir;
    this.store = opts.contentStore ?? new LocalContentStore(opts.dir);
    this.highThreshold = opts.highThreshold ?? DEFAULT_HIGH_THRESHOLD;
    this.mediumThreshold = opts.mediumThreshold ?? DEFAULT_MEDIUM_THRESHOLD;
  }

  // ── Public API ────────────────────────────────────────────────

  async remember(fact: string, opts: RememberOpts): Promise<RememberResult> {
    const existing = await this.loadAll();
    const newEmbed = this.embed(fact);

    // Find the best match among existing memories in the same scope
    let bestMatch: { file: MemoryFile; score: number } | null = null;
    for (const mem of existing) {
      if (mem.frontmatter.scope !== opts.scope) continue;
      const memEmbed = this.embed(mem.content);
      const score = cosineSimilarity(newEmbed, memEmbed);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { file: mem, score };
      }
    }

    const id = generateId();
    const now = new Date().toISOString();
    const slug = this.slugify(fact);
    const filePath = `${opts.scope}/${slug}.md`;

    const frontmatter: Partial<MemoryFrontmatter> = {
      id,
      scope: opts.scope,
      created: now,
    };
    if (opts.tags && opts.tags.length > 0) {
      frontmatter.tags = opts.tags;
    }
    if (opts.expires) {
      frontmatter.expires = opts.expires;
    }

    // Decide action based on similarity
    if (bestMatch && bestMatch.score >= this.highThreshold) {
      // Supersede: replace the old memory
      frontmatter.supersedes = bestMatch.file.frontmatter.id;
      const content = serializeMarkdown(frontmatter, fact);
      // Write new file
      await this.store.write(filePath, content);
      // Delete old file
      await this.store.delete(bestMatch.file.path);
      await this.generateIndex();
      return {
        action: "superseded",
        file: filePath,
        superseded: {
          file: bestMatch.file.path,
          content: bestMatch.file.content,
        },
      };
    } else if (bestMatch && bestMatch.score >= this.mediumThreshold) {
      // Related: create new but link to the related memory
      frontmatter["related-to"] = [bestMatch.file.frontmatter.id];
      const content = serializeMarkdown(frontmatter, fact);
      await this.store.write(filePath, content);
      await this.generateIndex();
      return {
        action: "related",
        file: filePath,
        relatedTo: bestMatch.file.frontmatter.id,
      };
    } else {
      // New: create independently
      const content = serializeMarkdown(frontmatter, fact);
      await this.store.write(filePath, content);
      await this.generateIndex();
      return {
        action: "created",
        file: filePath,
      };
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 10;
    const scopeFilter = opts?.scope;

    const all = await this.loadAll();
    const queryEmbed = this.embed(query);

    const scored: SearchResult[] = [];
    for (const mem of all) {
      if (scopeFilter && !scopeFilter.includes(mem.frontmatter.scope)) {
        continue;
      }
      const memEmbed = this.embed(mem.content);
      const score = cosineSimilarity(queryEmbed, memEmbed);
      const age = memoryAge(mem.frontmatter.created);
      scored.push({
        file: mem.path,
        content: mem.content,
        scope: mem.frontmatter.scope,
        score,
        age: age.label,
        stalenessCaveat: age.stalenessCaveat,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async pack(opts?: PackOpts): Promise<string> {
    const budget = opts?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const charBudget = budget * CHARS_PER_TOKEN;

    let memories: MemoryFile[];
    if (opts?.query) {
      const results = await this.search(opts.query, {
        limit: 50,
        scope: opts.scope,
      });
      // Convert search results back to ordered content
      const parts: string[] = [];
      let totalChars = 0;
      for (const r of results) {
        const block = `## ${r.file}\n${r.content}\n`;
        if (totalChars + block.length > charBudget) break;
        parts.push(block);
        totalChars += block.length;
      }
      return parts.join("\n");
    }

    // No query: load all, sort by scope priority then recency
    memories = await this.loadAll();
    if (opts?.scope) {
      memories = memories.filter((m) =>
        opts.scope!.includes(m.frontmatter.scope),
      );
    }
    memories.sort((a, b) => {
      const sPri =
        SCOPE_PRIORITY[a.frontmatter.scope] -
        SCOPE_PRIORITY[b.frontmatter.scope];
      if (sPri !== 0) return sPri;
      // More recent first
      return (
        new Date(b.frontmatter.created).getTime() -
        new Date(a.frontmatter.created).getTime()
      );
    });

    const parts: string[] = [];
    let totalChars = 0;
    for (const mem of memories) {
      const block = `## ${mem.path}\n${mem.content}\n`;
      if (totalChars + block.length > charBudget) break;
      parts.push(block);
      totalChars += block.length;
    }
    return parts.join("\n");
  }

  async consolidate(): Promise<ConsolidateResult> {
    let merged = 0;
    let archived = 0;
    let expired = 0;

    const all = await this.loadAll();
    const now = new Date();

    // 1. Archive superseded files
    for (const mem of all) {
      if (mem.frontmatter.supersedes) {
        // This memory supersedes another — check if the old one still exists
        // The old one should already be deleted in remember(), but in case of
        // manual edits, archive any memory that has been superseded by another.
      }
    }

    // Find memories that have been superseded (their id appears in another's supersedes field)
    const supersededIds = new Set(
      all
        .map((m) => m.frontmatter.supersedes)
        .filter((s): s is string => !!s),
    );
    for (const mem of all) {
      if (supersededIds.has(mem.frontmatter.id)) {
        const archivePath = `.db0/archive/${mem.path}`;
        const raw = await this.store.read(mem.path);
        await this.store.write(archivePath, raw);
        await this.store.delete(mem.path);
        archived++;
      }
    }

    // 2. Expire old session/task memories (>24h)
    const remaining = await this.loadAll();
    for (const mem of remaining) {
      if (
        mem.frontmatter.scope === "session" ||
        mem.frontmatter.scope === "task"
      ) {
        const created = new Date(mem.frontmatter.created);
        const hoursOld =
          (now.getTime() - created.getTime()) / (1000 * 60 * 60);
        if (hoursOld > SESSION_TASK_EXPIRE_HOURS) {
          await this.store.delete(mem.path);
          expired++;
        }
      }
      // Also check explicit expires field
      if (mem.frontmatter.expires) {
        const expiresDate = new Date(mem.frontmatter.expires);
        if (now > expiresDate) {
          await this.store.delete(mem.path);
          expired++;
        }
      }
    }

    // 3. Merge near-duplicates (score >= highThreshold, same scope)
    const afterExpire = await this.loadAll();
    const toDelete = new Set<string>();
    for (let i = 0; i < afterExpire.length; i++) {
      if (toDelete.has(afterExpire[i].path)) continue;
      for (let j = i + 1; j < afterExpire.length; j++) {
        if (toDelete.has(afterExpire[j].path)) continue;
        if (
          afterExpire[i].frontmatter.scope !==
          afterExpire[j].frontmatter.scope
        )
          continue;
        const embA = this.embed(afterExpire[i].content);
        const embB = this.embed(afterExpire[j].content);
        const score = cosineSimilarity(embA, embB);
        if (score >= this.highThreshold) {
          // Keep the newer one, delete the older one
          const aDate = new Date(afterExpire[i].frontmatter.created);
          const bDate = new Date(afterExpire[j].frontmatter.created);
          if (aDate >= bDate) {
            toDelete.add(afterExpire[j].path);
          } else {
            toDelete.add(afterExpire[i].path);
          }
          merged++;
        }
      }
    }
    for (const path of toDelete) {
      await this.store.delete(path);
    }

    await this.generateIndex();
    return { merged, archived, expired };
  }

  async generateIndex(): Promise<string> {
    const all = await this.loadAll();

    // Group by scope
    const groups: Record<string, MemoryFile[]> = {};
    for (const mem of all) {
      const scope = mem.frontmatter.scope;
      if (!groups[scope]) groups[scope] = [];
      groups[scope].push(mem);
    }

    const lines: string[] = ["# MEMORIES.md", ""];
    const scopeOrder: MemoryScope[] = ["user", "agent", "session", "task"];

    for (const scope of scopeOrder) {
      const mems = groups[scope];
      if (!mems || mems.length === 0) continue;

      lines.push(`## ${scope}`);
      lines.push("");
      for (const mem of mems) {
        const age = memoryAge(mem.frontmatter.created);
        let line = `- [${mem.path}](${mem.path}) — ${mem.content.split("\n")[0]}`;
        if (age.stalenessCaveat) {
          line += ` ⚠️ ${age.label}`;
        }
        lines.push(line);
      }
      lines.push("");
    }

    const content = lines.join("\n");
    await this.store.write("MEMORIES.md", content);
    return content;
  }

  // ── Private helpers ───────────────────────────────────────────

  private async loadAll(): Promise<MemoryFile[]> {
    const keys = await this.store.list();
    const files: MemoryFile[] = [];

    for (const key of keys) {
      const raw = await this.store.read(key);
      const { frontmatter, content } = parseMarkdown(raw);

      // Skip files without required frontmatter
      if (!frontmatter.id || !frontmatter.scope || !frontmatter.created) {
        continue;
      }

      files.push({
        path: key,
        frontmatter: frontmatter as MemoryFrontmatter,
        content,
      });
    }

    return files;
  }

  private embed(text: string): Float32Array {
    return hashEmbed(text);
  }

  private slugify(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }
}
