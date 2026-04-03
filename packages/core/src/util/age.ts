/**
 * Compute a human-readable age label and optional staleness caveat
 * from an ISO-8601 `createdAt` timestamp.
 */

export interface MemoryAge {
  /** Human-readable label, e.g. "today", "yesterday", "3 days ago" */
  label: string;
  /** Number of calendar days since creation (0 = today) */
  days: number;
  /** Non-null for memories older than 1 day */
  stalenessCaveat: string | null;
}

export function memoryAge(createdAt: string, now?: Date): MemoryAge {
  const created = new Date(createdAt);
  const ref = now ?? new Date();

  // Use UTC dates to avoid timezone edge cases
  const createdDay = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  const refDay = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const days = Math.floor((refDay - createdDay) / 86_400_000);

  let label: string;
  if (days <= 0) {
    label = "today";
  } else if (days === 1) {
    label = "yesterday";
  } else {
    label = `${days} days ago`;
  }

  const stalenessCaveat =
    days > 1
      ? `This memory is from ${label}. Verify against current code before acting on it.`
      : null;

  return { label, days, stalenessCaveat };
}
