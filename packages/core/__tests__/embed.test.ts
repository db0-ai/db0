import { describe, it, expect } from "vitest";
import { hashEmbed, defaultEmbeddingFn } from "../src/util/embed.js";
import { cosineSimilarity } from "../src/util/cosine.js";

describe("hashEmbed", () => {
  it("returns a Float32Array of the specified dimensions", () => {
    const vec = hashEmbed("hello world", 128);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(128);
  });

  it("defaults to 384 dimensions", () => {
    const vec = hashEmbed("hello world");
    expect(vec.length).toBe(384);
  });

  it("produces normalized vectors (unit length)", () => {
    const vec = hashEmbed("some text to embed");
    let mag = 0;
    for (let i = 0; i < vec.length; i++) mag += vec[i] * vec[i];
    expect(Math.sqrt(mag)).toBeCloseTo(1, 4);
  });

  it("is deterministic", () => {
    const a = hashEmbed("same input");
    const b = hashEmbed("same input");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  it("identical text has score 1", () => {
    const a = hashEmbed("user prefers dark mode");
    const b = hashEmbed("user prefers dark mode");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  it("similar text has higher score than unrelated text", () => {
    const query = hashEmbed("user prefers dark mode");
    const similar = hashEmbed("user prefers light mode");
    const unrelated = hashEmbed("the weather is sunny today");

    const simScore = cosineSimilarity(query, similar);
    const unrelScore = cosineSimilarity(query, unrelated);

    expect(simScore).toBeGreaterThan(unrelScore);
  });

  it("case insensitive", () => {
    const a = hashEmbed("Hello World");
    const b = hashEmbed("hello world");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  it("defaultEmbeddingFn is async wrapper", async () => {
    const vec = await defaultEmbeddingFn("test");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });
});
