import type {
  Db0Backend,
  MemoryContent,
  MemoryEdge,
  MemoryEdgeWriteOpts,
  MemoryEntry,
  MemoryScope,
  MemorySearchOpts,
  MemorySearchResult,
  MemoryWriteOpts,
} from "../types.js";
import { defaultSummarize } from "../util/summarize.js";

export class Memory {
  private summarizeFn?: (content: MemoryContent) => string | Promise<string>;

  constructor(
    private backend: Db0Backend,
    private agentId: string,
    private sessionId: string,
    private userId: string | null,
    summarizeFn?: (content: MemoryContent) => string | Promise<string>,
  ) {
    this.summarizeFn = summarizeFn;
  }

  async write(opts: MemoryWriteOpts): Promise<MemoryEntry> {
    // Auto-generate summary (L0) if not provided
    if (opts.summary === undefined) {
      opts = {
        ...opts,
        summary: this.summarizeFn
          ? await this.summarizeFn(opts.content)
          : defaultSummarize(opts.content),
      };
    }

    // task and session scoped memories carry sessionId
    // user and agent scoped memories do not
    const sessionId =
      opts.scope === "task" || opts.scope === "session"
        ? this.sessionId
        : null;

    return this.backend.memoryWrite(
      this.agentId,
      sessionId,
      this.userId,
      opts,
    );
  }

  async search(opts: MemorySearchOpts): Promise<MemorySearchResult[]> {
    let results = await this.backend.memorySearch(
      this.agentId,
      this.sessionId,
      this.userId,
      opts,
    );

    // Graph expansion: 1-hop traversal
    if (opts.graphExpand && results.length > 0) {
      const expandOpts = opts.graphExpand;
      const maxExpand = expandOpts.maxExpand ?? 5;
      const boostFactor = expandOpts.boostFactor ?? 0.1;
      const allowedTypes = expandOpts.edgeTypes
        ? new Set(expandOpts.edgeTypes)
        : null;

      const resultIds = new Set(results.map((r) => r.id));
      const expandedIds = new Set<string>();

      // Get edges for top results (limit to top 5 to avoid excessive queries)
      const topResults = results.slice(0, 5);
      for (const result of topResults) {
        const edges = await this.backend.memoryGetEdges(result.id);
        for (const edge of edges) {
          if (allowedTypes && !allowedTypes.has(edge.edgeType)) continue;
          const connectedId =
            edge.sourceId === result.id ? edge.targetId : edge.sourceId;
          if (!resultIds.has(connectedId) && !expandedIds.has(connectedId)) {
            expandedIds.add(connectedId);
          }
        }
      }

      // Fetch connected memories
      if (expandedIds.size > 0) {
        const idsToFetch = Array.from(expandedIds).slice(0, maxExpand);
        for (const id of idsToFetch) {
          const mem = await this.backend.memoryGet(id);
          if (mem && mem.status === "active") {
            results.push({
              ...mem,
              score: boostFactor,
              metadata: { ...mem.metadata, _graphExpanded: true },
            } as MemorySearchResult);
          }
        }
      }
    }

    if (opts.rerankFn && opts.queryText) {
      results = await opts.rerankFn(opts.queryText, results);
    }
    return results;
  }

  async list(scope?: MemoryScope): Promise<MemoryEntry[]> {
    return this.backend.memoryList(this.agentId, scope);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.backend.memoryGet(id);
  }

  async delete(id: string): Promise<void> {
    return this.backend.memoryDelete(id);
  }

  /** Add a typed relationship between two memories. */
  async addEdge(opts: MemoryEdgeWriteOpts): Promise<MemoryEdge> {
    return this.backend.memoryAddEdge(opts);
  }

  /** Get all edges (relationships) for a memory. */
  async getEdges(memoryId: string): Promise<MemoryEdge[]> {
    return this.backend.memoryGetEdges(memoryId);
  }

  /** Remove an edge. */
  async deleteEdge(edgeId: string): Promise<void> {
    return this.backend.memoryDeleteEdge(edgeId);
  }
}
