import { describe, it, expect } from "vitest";
import { isFallbackCandidate, createFallbackExtraction } from "../src/extraction/fallback.js";

describe("fallback extraction", () => {
  describe("isFallbackCandidate", () => {
    it("rejects short messages", () => {
      expect(isFallbackCandidate("Hello there.")).toBe(false);
      expect(isFallbackCandidate("OK sure.")).toBe(false);
    });

    it("rejects messages without soft signals", () => {
      expect(isFallbackCandidate(
        "The weather is quite nice today and the sky is blue and everything looks wonderful."
      )).toBe(false);
    });

    it("accepts substantial messages with soft signals", () => {
      expect(isFallbackCandidate(
        "I think we should switch to a monorepo structure because it simplifies dependency management."
      )).toBe(true);
    });

    it("accepts messages about bugs/issues", () => {
      expect(isFallbackCandidate(
        "There's a bug in the authentication flow where the token refresh fails after the session expires."
      )).toBe(true);
    });

    it("accepts messages about plans/architecture", () => {
      expect(isFallbackCandidate(
        "The architecture should use event sourcing for the order processing pipeline to maintain audit trails."
      )).toBe(true);
    });

    it("rejects pure noise even if long", () => {
      expect(isFallbackCandidate(
        "Sure. OK. Got it. Thanks. Yes. No. Right."
      )).toBe(false);
    });
  });

  describe("createFallbackExtraction", () => {
    it("returns null for non-candidates", () => {
      expect(createFallbackExtraction("Hello!")).toBeNull();
      expect(createFallbackExtraction("The weather is nice today and sunny.")).toBeNull();
    });

    it("creates a low-confidence extraction for substantial content", () => {
      const result = createFallbackExtraction(
        "I think we should migrate the database to Postgres because MySQL doesn't support the JSON operators we need."
      );
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.3);
      expect(result!.extractionMethod).toBe("fallback");
      expect(result!.sourceType).toBe("inference");
      expect(result!.tags).toContain("fallback-extraction");
    });

    it("condenses to max 3 sentences", () => {
      const result = createFallbackExtraction(
        "I think we need a new approach. The current system is broken. " +
        "We should consider microservices. The monolith has scaling issues. " +
        "Let's also add better monitoring. And improve the CI pipeline."
      );
      expect(result).not.toBeNull();
      const sentences = result!.content.split(/[.!?]\s+/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(3);
    });

    it("assigns task scope for bug-related content", () => {
      const result = createFallbackExtraction(
        "There's a critical bug in the payment processing module that causes duplicate charges."
      );
      expect(result).not.toBeNull();
      expect(result!.scope).toBe("task");
    });

    it("assigns session scope for decision-related content", () => {
      const result = createFallbackExtraction(
        "I think we should go with the event-driven architecture approach for the notification system."
      );
      expect(result).not.toBeNull();
      expect(result!.scope).toBe("session");
    });
  });
});
