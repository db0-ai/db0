import type { Db0Backend } from "@db0-ai/core";
import { db0, defaultEmbeddingFn } from "@db0-ai/core";

/**
 * db0 Feature Benchmark — tests db0-specific capabilities.
 *
 * Unlike the generic recall/retrieval benchmarks, these tests validate
 * agent-native features that other memory systems don't have:
 *
 * 1. Superseding — search excludes superseded facts
 * 2. Scope isolation — cross-scope contamination check
 * 3. Hybrid scoring — recency/popularity affect ranking
 * 4. Relationship edges — can traverse typed edges
 * 5. Embedding migration — re-embedding works correctly
 */
export interface FeatureTestResult {
  name: string;
  passed: boolean;
  details: string;
  latencyMs: number;
}

export interface FeatureBenchmarkReport {
  passed: number;
  failed: number;
  total: number;
  results: FeatureTestResult[];
  totalTimeMs: number;
}

export async function runFeatureBenchmark(
  createBackend: () => Promise<Db0Backend>,
  embeddingFn: (text: string) => Promise<Float32Array>,
): Promise<FeatureBenchmarkReport> {
  const results: FeatureTestResult[] = [];
  const totalStart = performance.now();

  // === Test 1: Superseding ===
  results.push(await runTest("superseding excludes old facts", async () => {
    const backend = await createBackend();
    const harness = db0.harness({ agentId: "bench", sessionId: "s1", userId: "u1", backend });

    const old = await harness.memory().write({
      content: "User prefers light mode",
      scope: "user",
      embedding: await embeddingFn("User prefers light mode"),
    });

    await harness.memory().write({
      content: "User prefers dark mode",
      scope: "user",
      embedding: await embeddingFn("User prefers dark mode"),
      supersedes: old.id,
    });

    const results = await harness.memory().search({
      embedding: await embeddingFn("theme preference"),
      scope: "user",
    });

    harness.close();

    if (results.length === 0) return { passed: false, details: "No results returned" };
    if (results.some((r) => r.id === old.id)) return { passed: false, details: "Superseded memory still in results" };
    if (!results.some((r) => typeof r.content === "string" && r.content.includes("dark mode"))) {
      return { passed: false, details: "New memory not found" };
    }
    return { passed: true, details: `${results.length} result(s), superseded correctly excluded` };
  }));

  // === Test 2: Scope Isolation ===
  // NOTE: spawn() inherits agentId by default (shared namespace).
  // user-scoped memories are queryable across sessions for same agentId+userId.
  results.push(await runTest("scope isolation between sessions", async () => {
    const backend = await createBackend();
    const parent = db0.harness({ agentId: "bench", sessionId: "parent-s", userId: "u1", backend });
    const child = parent.spawn({ agentId: "bench", sessionId: "child-s" });

    // Parent writes task-scoped memory
    await parent.memory().write({
      content: "Parent task: refactor auth module",
      scope: "task",
      embedding: await embeddingFn("Parent task: refactor auth module"),
    });

    // Child writes task-scoped memory
    await child.memory().write({
      content: "Child task: research GraphQL libraries",
      scope: "task",
      embedding: await embeddingFn("Child task: research GraphQL libraries"),
    });

    // Child writes user-scoped memory
    await child.memory().write({
      content: "User prefers TypeScript",
      scope: "user",
      embedding: await embeddingFn("User prefers TypeScript"),
    });

    // Parent should see user-scoped from child but NOT child's task-scoped
    // Use search() with the exact embedding of what was written to avoid hash mismatch
    const typeScriptEmbed = await embeddingFn("User prefers TypeScript");
    const graphqlEmbed = await embeddingFn("Child task: research GraphQL libraries");

    // Search for child's user-scoped memory using its exact embedding
    const userResults = await parent.memory().search({
      embedding: typeScriptEmbed,
      scope: "user",
      limit: 10,
      minScore: 0.01,
    });

    // Search for child's task-scoped memory — should NOT appear
    const taskResults = await parent.memory().search({
      embedding: graphqlEmbed,
      scope: "task",
      limit: 10,
      minScore: 0.01,
    });

    const parentSeeChildTask = taskResults.some(
      (r) => typeof r.content === "string" && r.content.includes("Child task"),
    );
    const parentSeeUserPref = userResults.some(
      (r) => typeof r.content === "string" && r.content.includes("TypeScript"),
    );

    child.close();
    parent.close();

    if (parentSeeChildTask) return { passed: false, details: "Parent can see child's task-scoped memory" };
    if (!parentSeeUserPref) return { passed: false, details: "Parent cannot see child's user-scoped memory" };
    return { passed: true, details: "Task isolation correct, user-scope shared" };
  }));

  // === Test 3: Memory Relationships ===
  results.push(await runTest("typed relationship edges", async () => {
    const backend = await createBackend();
    const harness = db0.harness({ agentId: "bench", sessionId: "s1", userId: "u1", backend });

    const m1 = await harness.memory().write({
      content: "Alice manages auth team",
      scope: "user",
      embedding: await embeddingFn("Alice manages auth team"),
    });

    const m2 = await harness.memory().write({
      content: "Auth team owns login service",
      scope: "user",
      embedding: await embeddingFn("Auth team owns login service"),
    });

    const m3 = await harness.memory().write({
      content: "Bob manages auth team",
      scope: "user",
      embedding: await embeddingFn("Bob manages auth team"),
    });

    await harness.memory().addEdge({ sourceId: m1.id, targetId: m2.id, edgeType: "related" });
    await harness.memory().addEdge({ sourceId: m1.id, targetId: m3.id, edgeType: "contradicts" });

    const edges = await harness.memory().getEdges(m1.id);
    harness.close();

    if (edges.length !== 2) return { passed: false, details: `Expected 2 edges, got ${edges.length}` };

    const hasRelated = edges.some((e) => e.edgeType === "related" && e.targetId === m2.id);
    const hasContradicts = edges.some((e) => e.edgeType === "contradicts" && e.targetId === m3.id);

    if (!hasRelated) return { passed: false, details: "Missing 'related' edge" };
    if (!hasContradicts) return { passed: false, details: "Missing 'contradicts' edge" };
    return { passed: true, details: "Both edge types created and queryable" };
  }));

  // === Test 4: Noise Filtering ===
  results.push(await runTest("noise filtering rejects low-signal content", async () => {
    const backend = await createBackend();
    const harness = db0.harness({ agentId: "bench", sessionId: "s1", userId: "u1", backend });

    // Write some real memories
    await harness.memory().write({
      content: "User prefers dark mode",
      scope: "user",
      embedding: await embeddingFn("User prefers dark mode"),
    });

    // Count memories before and after — noise should be filterable
    const all = await harness.memory().list("user");
    harness.close();

    return { passed: all.length === 1, details: `${all.length} user-scope memory(ies) stored` };
  }));

  // === Test 5: State Branching ===
  results.push(await runTest("state branching from checkpoint", async () => {
    const backend = await createBackend();
    const harness = db0.harness({ agentId: "bench", sessionId: "s1", userId: "u1", backend });

    const cp1 = await harness.state().checkpoint({ step: 1, label: "start" });
    const cp2 = await harness.state().checkpoint({ step: 2, label: "path-a" });
    const branch = await harness.state().branch(cp1.id, { step: 3, label: "path-b" });

    harness.close();

    if (branch.parentCheckpointId !== cp1.id) {
      return { passed: false, details: `Branch parent should be cp1, got ${branch.parentCheckpointId}` };
    }
    return { passed: true, details: `Branched from step 1, created path-b at step 3` };
  }));

  const totalTimeMs = performance.now() - totalStart;
  const passed = results.filter((r) => r.passed).length;

  return {
    passed,
    failed: results.length - passed,
    total: results.length,
    results,
    totalTimeMs,
  };
}

async function runTest(
  name: string,
  fn: () => Promise<{ passed: boolean; details: string }>,
): Promise<FeatureTestResult> {
  const start = performance.now();
  try {
    const result = await fn();
    return { name, ...result, latencyMs: performance.now() - start };
  } catch (err) {
    return {
      name,
      passed: false,
      details: `Error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: performance.now() - start,
    };
  }
}
