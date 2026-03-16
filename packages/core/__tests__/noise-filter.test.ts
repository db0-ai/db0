import { describe, it, expect } from "vitest";
import { isNoise, isNoiseBlock } from "../src/extraction/noise.js";
import { RulesExtractionStrategy } from "../src/extraction/rules.js";

describe("isNoise", () => {
  it("detects refusals", () => {
    expect(isNoise("I'm sorry, but I can't help with that.")).toBe(true);
    expect(isNoise("I can't help with that")).toBe(true);
    expect(isNoise("I am unable to assist with this request.")).toBe(true);
    expect(isNoise("Unfortunately, I cannot do that.")).toBe(true);
  });

  it("detects greetings and farewells", () => {
    expect(isNoise("Hello!")).toBe(true);
    expect(isNoise("Hi there!")).toBe(true);
    expect(isNoise("Good morning!")).toBe(true);
    expect(isNoise("Thanks!")).toBe(true);
    expect(isNoise("Goodbye!")).toBe(true);
    expect(isNoise("You're welcome!")).toBe(true);
  });

  it("detects meta-questions and filler", () => {
    expect(isNoise("What would you like me to do?")).toBe(true);
    expect(isNoise("Is there anything else I can help with?")).toBe(true);
    expect(isNoise("Sure!")).toBe(true);
    expect(isNoise("Got it.")).toBe(true);
    expect(isNoise("Of course!")).toBe(true);
  });

  it("detects process narration", () => {
    expect(isNoise("Let me search for that file.")).toBe(true);
    expect(isNoise("I'll look into this for you.")).toBe(true);
    expect(isNoise("Searching for relevant results...")).toBe(true);
  });

  it("rejects very short text", () => {
    expect(isNoise("ok")).toBe(true);
    expect(isNoise("yes")).toBe(true);
    expect(isNoise("")).toBe(true);
  });

  it("allows real content through", () => {
    expect(isNoise("User prefers TypeScript over JavaScript")).toBe(false);
    expect(isNoise("The API uses REST endpoints on port 3000")).toBe(false);
    expect(isNoise("Decided to use PostgreSQL for the database backend")).toBe(false);
    expect(isNoise("Remember that the deploy key is stored in 1Password")).toBe(false);
  });
});

describe("isNoiseBlock", () => {
  it("returns true when all sentences are noise", () => {
    expect(isNoiseBlock("Hello! Let me check that for you.")).toBe(true);
  });

  it("returns false when any sentence has real content", () => {
    expect(isNoiseBlock("Hello! User prefers dark mode.")).toBe(false);
  });

  it("returns true for empty text", () => {
    expect(isNoiseBlock("")).toBe(true);
  });
});

describe("RulesExtractionStrategy with noise filtering", () => {
  const strategy = new RulesExtractionStrategy();

  it("skips noise sentences but extracts real content", () => {
    const text = "Hello! Sure thing. The user prefers dark mode for all editors.";
    const results = strategy.extract(text);
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("prefers dark mode");
  });

  it("returns nothing for pure noise", () => {
    const text = "Hello! Got it. Let me search for that. Sure!";
    const results = strategy.extract(text);
    expect(results).toHaveLength(0);
  });
});
