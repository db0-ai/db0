import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src/markdown.js";

describe("parseMarkdown", () => {
  it("parses frontmatter and content", () => {
    const input = `---
id: m_abc123
scope: user
tags: [preference, language]
created: "2026-04-03T10:00:00Z"
---

User prefers Rust.`;

    const result = parseMarkdown(input);
    expect(result.frontmatter.id).toBe("m_abc123");
    expect(result.frontmatter.scope).toBe("user");
    expect(result.frontmatter.tags).toEqual(["preference", "language"]);
    expect(result.content).toBe("User prefers Rust.");
  });

  it("handles missing frontmatter", () => {
    const result = parseMarkdown("Just plain content.");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("Just plain content.");
  });

  it("handles partial frontmatter (scope only)", () => {
    const input = `---
scope: agent
---

A fact.`;
    const result = parseMarkdown(input);
    expect(result.frontmatter.scope).toBe("agent");
    expect(result.frontmatter.id).toBeUndefined();
    expect(result.content).toBe("A fact.");
  });
});

describe("serializeMarkdown", () => {
  it("serializes frontmatter and content", () => {
    const output = serializeMarkdown(
      {
        id: "m_abc123",
        scope: "user",
        tags: ["preference"],
        created: "2026-04-03T10:00:00Z",
      },
      "User prefers Rust.",
    );
    expect(output).toContain("id: m_abc123");
    expect(output).toContain("scope: user");
    expect(output).toContain("User prefers Rust.");
    expect(output.startsWith("---\n")).toBe(true);
  });

  it("roundtrips cleanly", () => {
    const fm = {
      id: "m_test",
      scope: "user" as const,
      tags: ["a", "b"],
      created: "2026-01-01T00:00:00Z",
    };
    const content = "Hello world.";
    const serialized = serializeMarkdown(fm, content);
    const parsed = parseMarkdown(serialized);
    expect(parsed.frontmatter.id).toBe("m_test");
    expect(parsed.frontmatter.scope).toBe("user");
    expect(parsed.frontmatter.tags).toEqual(["a", "b"]);
    expect(parsed.content).toBe(content);
  });
});
