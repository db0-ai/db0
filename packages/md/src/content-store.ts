import { readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { existsSync } from "node:fs";

export interface ContentStore {
  read(key: string): Promise<string>;
  write(key: string, content: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}

export class LocalContentStore implements ContentStore {
  constructor(private dir: string) {}

  async read(key: string): Promise<string> {
    return readFile(join(this.dir, key), "utf8");
  }

  async write(key: string, content: string): Promise<void> {
    const fullPath = join(this.dir, key);
    const parent = dirname(fullPath);
    if (!existsSync(parent)) {
      await mkdir(parent, { recursive: true });
    }
    await writeFile(fullPath, content, "utf8");
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.dir, key);
    if (existsSync(fullPath)) {
      await rm(fullPath);
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const scanDir = prefix ? join(this.dir, prefix) : this.dir;
    if (!existsSync(scanDir)) return [];
    return this.scanDir(scanDir);
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(join(this.dir, key));
  }

  private async scanDir(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.scanDir(fullPath)));
      } else if (entry.name.endsWith(".md") && entry.name !== "MEMORIES.md") {
        results.push(relative(this.dir, fullPath));
      }
    }
    return results;
  }
}
