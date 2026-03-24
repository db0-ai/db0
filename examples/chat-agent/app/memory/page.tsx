"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Memory {
  id: string;
  content: string;
  scope: string;
  status: string;
  tags: string[];
  summary?: string;
  createdAt: string;
  accessCount: number;
}

const SCOPE_COLORS: Record<string, string> = {
  user: "#0070f3",
  session: "#f5a623",
  task: "#7928ca",
  agent: "#50e3c2",
};

export default function MemoryDashboard() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/memories");
    if (res.ok) setMemories(await res.json());
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const filtered = filter === "all"
    ? memories
    : memories.filter((m) => m.scope === filter);

  const active = memories.filter((m) => m.status === "active");
  const superseded = memories.filter((m) => m.status === "superseded");
  const scopes = [...new Set(memories.map((m) => m.scope))];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", margin: 0, fontWeight: 600 }}>Memory Dashboard</h1>
          <p style={{ color: "#888", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
            Real-time view of what the agent knows
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            onClick={refresh}
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: 6,
              border: "1px solid #ddd",
              backgroundColor: "white",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
          <Link
            href="/"
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: 6,
              border: "1px solid #ddd",
              backgroundColor: "white",
              fontSize: "0.8rem",
              textDecoration: "none",
              color: "#333",
            }}
          >
            ← Back to Chat
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <StatCard label="Total" value={memories.length} />
        <StatCard label="Active" value={active.length} color="#22c55e" />
        <StatCard label="Superseded" value={superseded.length} color="#f59e0b" />
        {scopes.map((s) => (
          <StatCard
            key={s}
            label={s}
            value={memories.filter((m) => m.scope === s).length}
            color={SCOPE_COLORS[s]}
          />
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <FilterButton label="All" value="all" current={filter} onClick={setFilter} />
        {scopes.map((s) => (
          <FilterButton key={s} label={s} value={s} current={filter} onClick={setFilter} />
        ))}
      </div>

      {/* Memory list */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem 1rem",
            color: "#bbb",
            fontSize: "0.9rem",
          }}
        >
          No memories yet. Start chatting to build the agent&apos;s memory.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {filtered.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "0.75rem 1rem",
                borderRadius: 8,
                border: "1px solid #eee",
                backgroundColor: m.status === "superseded" ? "#fafafa" : "white",
                opacity: m.status === "superseded" ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                <span
                  style={{
                    fontSize: "0.65rem",
                    padding: "0.15rem 0.4rem",
                    borderRadius: 4,
                    backgroundColor: SCOPE_COLORS[m.scope] ?? "#999",
                    color: "white",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  {m.scope}
                </span>
                {m.status === "superseded" && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "0.15rem 0.4rem",
                      borderRadius: 4,
                      backgroundColor: "#f59e0b",
                      color: "white",
                      fontWeight: 600,
                    }}
                  >
                    SUPERSEDED
                  </span>
                )}
                {m.tags?.length > 0 && (
                  <span style={{ fontSize: "0.7rem", color: "#999" }}>
                    {m.tags.join(", ")}
                  </span>
                )}
                <span style={{ fontSize: "0.7rem", color: "#ccc", marginLeft: "auto" }}>
                  {new Date(m.createdAt).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>
                {typeof m.content === "string" ? m.content : JSON.stringify(m.content)}
              </div>
              {m.accessCount > 0 && (
                <div style={{ fontSize: "0.7rem", color: "#aaa", marginTop: "0.25rem" }}>
                  Retrieved {m.accessCount} time{m.accessCount > 1 ? "s" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div
      style={{
        padding: "0.75rem",
        borderRadius: 8,
        border: "1px solid #eee",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: color ?? "#333" }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "capitalize" }}>{label}</div>
    </div>
  );
}

function FilterButton({
  label,
  value,
  current,
  onClick,
}: {
  label: string;
  value: string;
  current: string;
  onClick: (v: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(value)}
      style={{
        padding: "0.3rem 0.7rem",
        borderRadius: 6,
        border: "1px solid #ddd",
        backgroundColor: current === value ? "#0070f3" : "white",
        color: current === value ? "white" : "#555",
        fontSize: "0.8rem",
        cursor: "pointer",
        textTransform: "capitalize",
      }}
    >
      {label}
    </button>
  );
}
