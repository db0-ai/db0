import { describe, it, expect } from "vitest";
import { memoryAge } from "../src/util/age.js";

describe("memoryAge", () => {
  const now = new Date("2025-06-15T12:00:00Z");

  it("returns 'today' for same-day memories", () => {
    const result = memoryAge("2025-06-15T08:00:00Z", now);
    expect(result.label).toBe("today");
    expect(result.days).toBe(0);
    expect(result.stalenessCaveat).toBeNull();
  });

  it("returns 'yesterday' for 1-day-old memories", () => {
    const result = memoryAge("2025-06-14T20:00:00Z", now);
    expect(result.label).toBe("yesterday");
    expect(result.days).toBe(1);
    expect(result.stalenessCaveat).toBeNull();
  });

  it("returns 'N days ago' with caveat for older memories", () => {
    const result = memoryAge("2025-06-10T12:00:00Z", now);
    expect(result.label).toBe("5 days ago");
    expect(result.days).toBe(5);
    expect(result.stalenessCaveat).toContain("5 days ago");
    expect(result.stalenessCaveat).toContain("Verify");
  });

  it("handles very old memories", () => {
    const result = memoryAge("2025-01-01T00:00:00Z", now);
    expect(result.days).toBe(165);
    expect(result.label).toBe("165 days ago");
    expect(result.stalenessCaveat).not.toBeNull();
  });

  it("uses current time when now is omitted", () => {
    const result = memoryAge(new Date().toISOString());
    expect(result.label).toBe("today");
    expect(result.days).toBe(0);
  });
});
