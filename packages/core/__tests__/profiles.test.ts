import { describe, it, expect } from "vitest";
import {
  mergeProfiles,
  PROFILES,
  PROFILE_CONVERSATIONAL,
  PROFILE_AGENT_CONTEXT,
  PROFILE_KNOWLEDGE_BASE,
  PROFILE_CODING_ASSISTANT,
  PROFILE_CURATED_MEMORY,
  PROFILE_HIGH_RECALL,
  PROFILE_MINIMAL,
} from "../src/index.js";
import type { Db0Profile } from "../src/index.js";

describe("Db0Profile", () => {
  describe("built-in profiles", () => {
    it("exports all seven presets", () => {
      expect(Object.keys(PROFILES)).toEqual([
        "conversational",
        "agent-context",
        "knowledge-base",
        "coding-assistant",
        "curated-memory",
        "high-recall",
        "minimal",
      ]);
    });

    it("PROFILES index matches named exports", () => {
      expect(PROFILES.conversational).toBe(PROFILE_CONVERSATIONAL);
      expect(PROFILES["agent-context"]).toBe(PROFILE_AGENT_CONTEXT);
      expect(PROFILES["knowledge-base"]).toBe(PROFILE_KNOWLEDGE_BASE);
      expect(PROFILES["coding-assistant"]).toBe(PROFILE_CODING_ASSISTANT);
      expect(PROFILES["curated-memory"]).toBe(PROFILE_CURATED_MEMORY);
      expect(PROFILES["high-recall"]).toBe(PROFILE_HIGH_RECALL);
      expect(PROFILES.minimal).toBe(PROFILE_MINIMAL);
    });

    it("each profile has name and description", () => {
      for (const [key, profile] of Object.entries(PROFILES)) {
        expect(profile.name).toBe(key);
        expect(profile.description).toBeTruthy();
      }
    });

    it("conversational uses session mode with high recency", () => {
      expect(PROFILE_CONVERSATIONAL.ingest?.mode).toBe("session");
      expect(PROFILE_CONVERSATIONAL.retrieval?.scoring).toBe("hybrid");
      expect(PROFILE_CONVERSATIONAL.retrieval?.hybridWeights?.recency).toBeGreaterThan(0.2);
      expect(PROFILE_CONVERSATIONAL.retrieval?.decayHalfLifeDays).toBeLessThanOrEqual(7);
    });

    it("agent-context is the balanced hybrid profile", () => {
      expect(PROFILE_AGENT_CONTEXT.ingest?.mode).toBe("chunk");
      expect(PROFILE_AGENT_CONTEXT.ingest?.enrich).toBe(true);
      expect(PROFILE_AGENT_CONTEXT.retrieval?.hybridWeights?.similarity).toBe(0.65);
      expect(PROFILE_AGENT_CONTEXT.retrieval?.hybridWeights?.recency).toBe(0.2);
      expect(PROFILE_AGENT_CONTEXT.retrieval?.graphExpand?.enabled).toBe(true);
      expect(PROFILE_AGENT_CONTEXT.reconciliation?.autoReconcile).toBe(true);
    });

    it("knowledge-base uses rewrite enrichment with latent bridging", () => {
      expect(PROFILE_KNOWLEDGE_BASE.ingest?.mode).toBe("chunk");
      expect(PROFILE_KNOWLEDGE_BASE.ingest?.enrich).toBe(true);
      expect(PROFILE_KNOWLEDGE_BASE.ingest?.enrichMode).toBe("rewrite");
      expect(PROFILE_KNOWLEDGE_BASE.ingest?.latentBridging).toBe(true);
      expect(PROFILE_KNOWLEDGE_BASE.retrieval?.queryExpansion).toBe(true);
      expect(PROFILE_KNOWLEDGE_BASE.retrieval?.decayHalfLifeDays).toBeGreaterThanOrEqual(30);
    });

    it("coding-assistant has high similarity weight and long decay", () => {
      expect(PROFILE_CODING_ASSISTANT.retrieval?.hybridWeights?.similarity).toBeGreaterThanOrEqual(0.8);
      expect(PROFILE_CODING_ASSISTANT.retrieval?.decayHalfLifeDays).toBeGreaterThanOrEqual(30);
      expect(PROFILE_CODING_ASSISTANT.ingest?.enrich).toBe(false);
      expect(PROFILE_CODING_ASSISTANT.retrieval?.queryExpansion).toBe(false);
    });

    it("curated-memory has latent bridging, near-zero decay, and manual extraction", () => {
      expect(PROFILE_CURATED_MEMORY.retrieval?.hybridWeights?.similarity).toBe(0.9);
      expect(PROFILE_CURATED_MEMORY.retrieval?.hybridWeights?.recency).toBe(0.05);
      expect(PROFILE_CURATED_MEMORY.retrieval?.decayHalfLifeDays).toBeGreaterThanOrEqual(90);
      expect(PROFILE_CURATED_MEMORY.extraction?.strategy).toBe("manual");
      expect(PROFILE_CURATED_MEMORY.ingest?.enrich).toBe(false);
      expect(PROFILE_CURATED_MEMORY.ingest?.latentBridging).toBe(true);
      expect(PROFILE_CURATED_MEMORY.retrieval?.graphExpand?.enabled).toBe(false);
    });

    it("high-recall has low thresholds, expansion, and latent bridging", () => {
      expect(PROFILE_HIGH_RECALL.retrieval?.minScore).toBeLessThanOrEqual(0.25);
      expect(PROFILE_HIGH_RECALL.retrieval?.topK).toBeGreaterThanOrEqual(15);
      expect(PROFILE_HIGH_RECALL.retrieval?.queryExpansion).toBe(true);
      expect(PROFILE_HIGH_RECALL.ingest?.enrichWindowSize).toBe(2);
      expect(PROFILE_HIGH_RECALL.ingest?.latentBridging).toBe(true);
    });

    it("minimal disables enrichment, expansion, and graph", () => {
      expect(PROFILE_MINIMAL.ingest?.enrich).toBe(false);
      expect(PROFILE_MINIMAL.retrieval?.queryExpansion).toBe(false);
      expect(PROFILE_MINIMAL.retrieval?.graphExpand?.enabled).toBe(false);
      expect(PROFILE_MINIMAL.retrieval?.scoring).toBe("similarity");
    });

    it("hybrid weights sum to 1.0 for all profiles that use hybrid scoring", () => {
      for (const [name, profile] of Object.entries(PROFILES)) {
        if (profile.retrieval?.scoring === "hybrid" && profile.retrieval?.hybridWeights) {
          const w = profile.retrieval.hybridWeights;
          const sum = (w.similarity ?? 0) + (w.recency ?? 0) + (w.popularity ?? 0);
          expect(sum).toBeCloseTo(1.0, 5);
        }
      }
    });
  });

  describe("mergeProfiles", () => {
    it("override replaces primitive values", () => {
      const base: Db0Profile = { name: "base", retrieval: { topK: 10 } };
      const overrides: Db0Profile = { retrieval: { topK: 20 } };
      const merged = mergeProfiles(base, overrides);
      expect(merged.retrieval?.topK).toBe(20);
      expect(merged.name).toBe("base"); // not overridden
    });

    it("override adds new nested fields without removing existing ones", () => {
      const base: Db0Profile = {
        retrieval: { topK: 10, minScore: 0.4 },
      };
      const overrides: Db0Profile = {
        retrieval: { topK: 5, scoring: "rrf" },
      };
      const merged = mergeProfiles(base, overrides);
      expect(merged.retrieval?.topK).toBe(5);
      expect(merged.retrieval?.minScore).toBe(0.4); // preserved from base
      expect(merged.retrieval?.scoring).toBe("rrf"); // added from override
    });

    it("deep-merges hybridWeights (3 levels deep)", () => {
      const base: Db0Profile = {
        retrieval: {
          hybridWeights: { similarity: 0.7, recency: 0.2, popularity: 0.1 },
        },
      };
      const overrides: Db0Profile = {
        retrieval: {
          hybridWeights: { recency: 0.4 },
        },
      };
      const merged = mergeProfiles(base, overrides);
      expect(merged.retrieval?.hybridWeights?.similarity).toBe(0.7);
      expect(merged.retrieval?.hybridWeights?.recency).toBe(0.4);
      expect(merged.retrieval?.hybridWeights?.popularity).toBe(0.1);
    });

    it("empty override returns copy of base", () => {
      const base = PROFILE_CONVERSATIONAL;
      const merged = mergeProfiles(base, {});
      expect(merged).toEqual(base);
      expect(merged).not.toBe(base); // new object
    });

    it("does not mutate base or overrides", () => {
      const base: Db0Profile = { retrieval: { topK: 10 } };
      const overrides: Db0Profile = { retrieval: { topK: 20 } };
      const baseCopy = JSON.parse(JSON.stringify(base));
      const overCopy = JSON.parse(JSON.stringify(overrides));
      mergeProfiles(base, overrides);
      expect(base).toEqual(baseCopy);
      expect(overrides).toEqual(overCopy);
    });

    it("override with new section adds it", () => {
      const base: Db0Profile = { name: "base" };
      const overrides: Db0Profile = {
        ingest: { mode: "chunk", chunkSize: 500 },
      };
      const merged = mergeProfiles(base, overrides);
      expect(merged.ingest?.mode).toBe("chunk");
      expect(merged.ingest?.chunkSize).toBe(500);
    });

    it("array values are replaced, not merged", () => {
      const base: Db0Profile = {
        retrieval: { graphExpand: { edgeTypes: ["related", "supports"] } },
      };
      const overrides: Db0Profile = {
        retrieval: { graphExpand: { edgeTypes: ["contradicts"] } },
      };
      const merged = mergeProfiles(base, overrides);
      expect(merged.retrieval?.graphExpand?.edgeTypes).toEqual(["contradicts"]);
    });

    it("can layer a preset with custom overrides (real-world usage)", () => {
      const custom = mergeProfiles(PROFILE_AGENT_CONTEXT, {
        retrieval: {
          topK: 12,
          decayHalfLifeDays: 21,
          hybridWeights: { recency: 0.3 },
        },
      });
      // Overridden
      expect(custom.retrieval?.topK).toBe(12);
      expect(custom.retrieval?.decayHalfLifeDays).toBe(21);
      expect(custom.retrieval?.hybridWeights?.recency).toBe(0.3);
      // Preserved from base
      expect(custom.retrieval?.hybridWeights?.similarity).toBe(0.65);
      expect(custom.retrieval?.hybridWeights?.popularity).toBe(0.15);
      expect(custom.retrieval?.graphExpand?.enabled).toBe(true);
      expect(custom.ingest?.enrich).toBe(true);
      expect(custom.name).toBe("agent-context");
    });
  });
});
