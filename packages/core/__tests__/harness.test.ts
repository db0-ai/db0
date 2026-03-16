import { describe, it, expect, vi } from "vitest";
import { db0 } from "../src/index.js";
import type { Db0Backend } from "../src/types.js";

function createMockBackend(): Db0Backend {
  return {
    memoryWrite: vi.fn(),
    memorySearch: vi.fn(),
    memoryList: vi.fn(),
    memoryDelete: vi.fn(),
    memoryGet: vi.fn(),
    memoryAddEdge: vi.fn(),
    memoryGetEdges: vi.fn(),
    memoryDeleteEdge: vi.fn(),
    stateCheckpoint: vi.fn(),
    stateRestore: vi.fn(),
    stateList: vi.fn(),
    stateGetCheckpoint: vi.fn(),
    logAppend: vi.fn(),
    logQuery: vi.fn(),
    close: vi.fn(),
  };
}

describe("Harness", () => {
  it("creates a harness with correct properties", () => {
    const backend = createMockBackend();
    const harness = db0.harness({
      agentId: "agent-1",
      sessionId: "session-1",
      userId: "user-1",
      backend,
    });

    expect(harness.agentId).toBe("agent-1");
    expect(harness.sessionId).toBe("session-1");
    expect(harness.userId).toBe("user-1");
  });

  it("returns same component instances on repeated access", () => {
    const backend = createMockBackend();
    const harness = db0.harness({
      agentId: "agent-1",
      sessionId: "session-1",
      backend,
    });

    expect(harness.memory()).toBe(harness.memory());
    expect(harness.state()).toBe(harness.state());
    expect(harness.log()).toBe(harness.log());
  });

  it("defaults userId to null", () => {
    const backend = createMockBackend();
    const harness = db0.harness({
      agentId: "agent-1",
      sessionId: "session-1",
      backend,
    });

    expect(harness.userId).toBeNull();
  });

  it("defaults extraction to rules strategy", () => {
    const backend = createMockBackend();
    const harness = db0.harness({
      agentId: "agent-1",
      sessionId: "session-1",
      backend,
    });

    const strategy = harness.extraction();
    // Rules strategy should extract from signal words
    const results = strategy.extract("The user prefers TypeScript.");
    expect(results.length).toBeGreaterThan(0);
  });

  it("uses manual extraction when configured", () => {
    const backend = createMockBackend();
    const harness = db0.harness({
      agentId: "agent-1",
      sessionId: "session-1",
      backend,
      extraction: { durableFacts: "manual" },
    });

    const strategy = harness.extraction();
    const results = strategy.extract("The user prefers TypeScript.");
    expect(results).toHaveLength(0);
  });

  it("calls backend.close() on close", () => {
    const backend = createMockBackend();
    const harness = db0.harness({
      agentId: "agent-1",
      sessionId: "session-1",
      backend,
    });

    harness.close();
    expect(backend.close).toHaveBeenCalled();
  });

  // === spawn ===

  it("spawns a child harness with shared backend", () => {
    const backend = createMockBackend();
    const parent = db0.harness({
      agentId: "parent",
      sessionId: "parent-session",
      userId: "user-1",
      backend,
    });

    const child = parent.spawn({
      agentId: "child",
      sessionId: "child-session",
    });

    expect(child.agentId).toBe("child");
    expect(child.sessionId).toBe("child-session");
    expect(child.userId).toBe("user-1"); // inherited
    expect(child.parentAgentId).toBe("parent");
  });

  it("child inherits userId from parent by default", () => {
    const backend = createMockBackend();
    const parent = db0.harness({
      agentId: "parent",
      sessionId: "s1",
      userId: "user-42",
      backend,
    });

    const child = parent.spawn({ agentId: "child", sessionId: "s2" });
    expect(child.userId).toBe("user-42");
  });

  it("child can override userId", () => {
    const backend = createMockBackend();
    const parent = db0.harness({
      agentId: "parent",
      sessionId: "s1",
      userId: "user-42",
      backend,
    });

    const child = parent.spawn({
      agentId: "child",
      sessionId: "s2",
      userId: "different-user",
    });
    expect(child.userId).toBe("different-user");
  });

  it("root harness has no parentAgentId", () => {
    const backend = createMockBackend();
    const harness = db0.harness({
      agentId: "root",
      sessionId: "s1",
      backend,
    });
    expect(harness.parentAgentId).toBeNull();
  });

  it("child close does not close the backend", () => {
    const backend = createMockBackend();
    const parent = db0.harness({
      agentId: "parent",
      sessionId: "s1",
      backend,
    });

    const child = parent.spawn({ agentId: "child", sessionId: "s2" });
    child.close();

    expect(backend.close).not.toHaveBeenCalled();
  });

  it("parent close closes the backend", () => {
    const backend = createMockBackend();
    const parent = db0.harness({
      agentId: "parent",
      sessionId: "s1",
      backend,
    });

    parent.spawn({ agentId: "child", sessionId: "s2" });
    parent.close();

    expect(backend.close).toHaveBeenCalledTimes(1);
  });
});
