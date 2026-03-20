import { describe, it, expect, vi } from "vitest";
import { createDb0PiExtension } from "../src/extension.js";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

function createMockPi() {
  const tools = new Map<string, { execute: (args: Record<string, unknown>) => Promise<string> }>();
  const handlers = new Map<string, Array<(...args: unknown[]) => void | Promise<void>>>();

  return {
    registerTool: vi.fn((def: any) => {
      tools.set(def.name, def);
    }),
    on: vi.fn((event: string, handler: any) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    // Test helpers
    _tools: tools,
    _handlers: handlers,
    async _emit(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) {
        await h(...args);
      }
    },
  };
}

describe("db0 Pi Extension", () => {
  it("registers three memory tools", async () => {
    const backend = await createSqliteBackend({ dbPath: ":memory:" });
    const ext = await createDb0PiExtension({ backend });
    const pi = createMockPi();

    ext.register(pi);

    expect(pi.registerTool).toHaveBeenCalledTimes(3);
    expect(pi._tools.has("db0_memory_write")).toBe(true);
    expect(pi._tools.has("db0_memory_search")).toBe(true);
    expect(pi._tools.has("db0_memory_list")).toBe(true);

    ext.harness.close();
  });

  it("registers lifecycle event handlers", async () => {
    const backend = await createSqliteBackend({ dbPath: ":memory:" });
    const ext = await createDb0PiExtension({ backend });
    const pi = createMockPi();

    ext.register(pi);

    const events = pi.on.mock.calls.map((c: any) => c[0]);
    expect(events).toContain("before_agent_start");
    expect(events).toContain("turn_end");
    expect(events).toContain("session_before_compact");
    expect(events).toContain("session_start");
    expect(events).toContain("session_shutdown");

    ext.harness.close();
  });

  it("write tool stores a memory", async () => {
    const backend = await createSqliteBackend({ dbPath: ":memory:" });
    const ext = await createDb0PiExtension({ backend });
    const pi = createMockPi();

    ext.register(pi);

    const writeTool = pi._tools.get("db0_memory_write")!;
    const result = JSON.parse(
      await writeTool.execute({ content: "User prefers dark mode", scope: "user" }),
    );

    expect(result.status).toBe("saved");
    expect(result.content).toBe("User prefers dark mode");

    ext.harness.close();
  });

  it("search tool finds stored memories", async () => {
    const backend = await createSqliteBackend({ dbPath: ":memory:" });
    const ext = await createDb0PiExtension({ backend });
    const pi = createMockPi();

    ext.register(pi);

    const writeTool = pi._tools.get("db0_memory_write")!;
    const searchTool = pi._tools.get("db0_memory_search")!;

    await writeTool.execute({ content: "User prefers TypeScript", scope: "user" });

    const results = JSON.parse(
      await searchTool.execute({ query: "User prefers TypeScript", limit: 5 }),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBe("User prefers TypeScript");

    ext.harness.close();
  });

  it("list tool returns all memories", async () => {
    const backend = await createSqliteBackend({ dbPath: ":memory:" });
    const ext = await createDb0PiExtension({ backend });
    const pi = createMockPi();

    ext.register(pi);

    const writeTool = pi._tools.get("db0_memory_write")!;
    const listTool = pi._tools.get("db0_memory_list")!;

    await writeTool.execute({ content: "Fact one", scope: "user" });
    await writeTool.execute({ content: "Fact two", scope: "user" });

    const all = JSON.parse(await listTool.execute({}));
    expect(all).toHaveLength(2);

    ext.harness.close();
  });

  it("turn_end extracts facts from assistant messages", async () => {
    const backend = await createSqliteBackend({ dbPath: ":memory:" });
    const ext = await createDb0PiExtension({ backend });
    const pi = createMockPi();

    ext.register(pi);

    // Simulate a turn_end with assistant content containing signal words
    await pi._emit("turn_end", {}, {
      message: { content: "I'll remember that you always use bun as your package manager." },
    });

    const memories = await ext.harness.memory().list();
    expect(memories.length).toBeGreaterThan(0);
    const contents = memories.map((m) => String(m.content));
    expect(contents.some((c) => c.toLowerCase().includes("bun"))).toBe(true);

    ext.harness.close();
  });

  it("session_shutdown triggers reconcile and close", async () => {
    const backend = await createSqliteBackend({ dbPath: ":memory:" });
    const ext = await createDb0PiExtension({ backend });
    const pi = createMockPi();

    ext.register(pi);

    // Should not throw
    await pi._emit("session_shutdown");
  });
});
