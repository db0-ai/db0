import { describe, it, expect, vi } from "vitest";
import { enrichChunks } from "../src/ingest/enricher.js";
import type { ChunkEnrichFn } from "../src/ingest/enricher.js";

describe("enrichChunks", () => {
  it("calls enrichFn for each chunk with correct context", async () => {
    const chunks = ["chunk-A", "chunk-B", "chunk-C"];
    const calls: Array<{ chunk: string; before: string; after: string }> = [];

    const enrichFn: ChunkEnrichFn = async (chunk, ctx) => {
      calls.push({ chunk, before: ctx.before, after: ctx.after });
      return `enriched-${chunk}`;
    };

    const result = await enrichChunks(chunks, enrichFn, 1);

    expect(result).toEqual(["enriched-chunk-A", "enriched-chunk-B", "enriched-chunk-C"]);
    expect(calls).toHaveLength(3);

    // First chunk: no before context
    expect(calls[0].before).toBe("");
    expect(calls[0].after).toBe("chunk-B");

    // Middle chunk: both contexts
    expect(calls[1].before).toBe("chunk-A");
    expect(calls[1].after).toBe("chunk-C");

    // Last chunk: no after context
    expect(calls[2].before).toBe("chunk-B");
    expect(calls[2].after).toBe("");
  });

  it("uses wider window when windowSize > 1", async () => {
    const chunks = ["A", "B", "C", "D", "E"];
    const calls: Array<{ before: string; after: string }> = [];

    const enrichFn: ChunkEnrichFn = async (chunk, ctx) => {
      calls.push({ before: ctx.before, after: ctx.after });
      return chunk;
    };

    await enrichChunks(chunks, enrichFn, 2);

    // Middle chunk (C, index 2) should see A+B before and D+E after
    expect(calls[2].before).toBe("A\n\nB");
    expect(calls[2].after).toBe("D\n\nE");
  });

  it("falls through to original chunk on empty enrichFn return", async () => {
    const chunks = ["original"];
    const enrichFn: ChunkEnrichFn = async () => "";

    const result = await enrichChunks(chunks, enrichFn);
    // enrichChunks itself doesn't enforce fallback — that's the caller's job
    expect(result).toEqual([""]);
  });

  it("passes correct chunkIndex and totalChunks", async () => {
    const chunks = ["X", "Y"];
    const indices: Array<{ idx: number; total: number }> = [];

    const enrichFn: ChunkEnrichFn = async (chunk, ctx) => {
      indices.push({ idx: ctx.chunkIndex, total: ctx.totalChunks });
      return chunk;
    };

    await enrichChunks(chunks, enrichFn);
    expect(indices).toEqual([
      { idx: 0, total: 2 },
      { idx: 1, total: 2 },
    ]);
  });
});
