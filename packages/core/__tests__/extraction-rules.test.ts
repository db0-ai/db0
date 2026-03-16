import { describe, it, expect } from "vitest";
import { RulesExtractionStrategy } from "../src/extraction/rules.js";

describe("RulesExtractionStrategy", () => {
  const strategy = new RulesExtractionStrategy();

  it("extracts user preferences", () => {
    const results = strategy.extract("The user prefers TypeScript over Python.");
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe("user");
    expect(results[0].tags).toContain("preference");
    expect(results[0].content).toContain("user prefers");
  });

  it("extracts 'always use' patterns", () => {
    const results = strategy.extract("They always use dark mode.");
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe("user");
  });

  it("extracts 'remember that' patterns", () => {
    const results = strategy.extract("Remember that the API key is in .env.");
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe("user");
  });

  it("extracts task context", () => {
    const results = strategy.extract("I'm working on the authentication module.");
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe("task");
    expect(results[0].tags).toContain("task");
  });

  it("extracts session decisions", () => {
    const results = strategy.extract("We decided to use Redis for caching.");
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe("session");
    expect(results[0].tags).toContain("decision");
  });

  it("extracts 'important:' patterns", () => {
    const results = strategy.extract("Important: the deploy must happen before 5pm.");
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe("session");
  });

  it("extracts multiple facts from multi-sentence text", () => {
    const text =
      "The user prefers dark mode. I'm working on the login page. We decided to use OAuth.";
    const results = strategy.extract(text);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.scope)).toEqual(["user", "task", "session"]);
  });

  it("returns empty for irrelevant text", () => {
    const results = strategy.extract("The weather is nice today.");
    expect(results).toHaveLength(0);
  });

  it("matches only one signal per sentence", () => {
    const results = strategy.extract("User prefers to always use TypeScript.");
    expect(results).toHaveLength(1);
  });

  it("includes provenance fields on all rule-extracted results", () => {
    const text =
      "The user prefers dark mode. I'm working on the login page. We decided to use OAuth.";
    const results = strategy.extract(text);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sourceType).toBe("user_statement");
      expect(r.extractionMethod).toBe("rules");
    }
  });
});
