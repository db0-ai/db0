"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState, useCallback, type FormEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

interface ChatSummary { id: string; title: string; createdAt: string }
interface MemoryUsed { id: string; content: string; scope: string; score: number }
interface ThinkingState {
  step: "searching" | "found" | "generating" | "extracting" | "done";
  memories: MemoryUsed[];
  count: number;
}

const SCOPE_COLORS: Record<string, string> = {
  user: "#0070f3", session: "#f5a623", task: "#7928ca", agent: "#50e3c2",
};

export default function Chat() {
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [chatList, setChatList] = useState<ChatSummary[]>([]);
  const [thinking, setThinking] = useState<ThinkingState | null>(null);
  const [lastMemories, setLastMemories] = useState<MemoryUsed[]>([]);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);

  const { messages, input, handleInputChange, handleSubmit: rawSubmit, status, error, setMessages } =
    useChat({
      api: "/api/chat",
      body: { chatId, userId: "demo-user" },
      streamProtocol: "text",
    });

  // Clear thinking when status returns to ready (response complete)
  useEffect(() => {
    if (status === "ready" && thinking) {
      setThinking(null);
      // Refresh chat list
      fetch("/api/chats").then((r) => r.json()).then(setChatList).catch(() => {});
    }
  }, [status, thinking]);

  useEffect(() => {
    fetch("/api/chats").then((r) => r.json()).then(setChatList).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // Custom submit — search memory first, then send to chat
  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "streaming") return;

    // Step 1: Search memory
    setThinking({ step: "searching", memories: [], count: 0 });

    try {
      const searchRes = await fetch("/api/memories/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: input, chatId, userId: "demo-user" }),
      });
      const memData = await searchRes.json();

      if (memData.count > 0) {
        setThinking({ step: "found", memories: memData.memories, count: memData.count });
        setLastMemories(memData.memories);
        await new Promise((r) => setTimeout(r, 800)); // Brief pause to show memories
      }
    } catch {
      // Memory search failed — continue without it
    }

    // Step 2: Generate response
    setThinking((t) => t ? { ...t, step: "generating" } : { step: "generating", memories: [], count: 0 });

    // Trigger the actual chat submit
    rawSubmit(e);
  }, [input, status, chatId, rawSubmit]);

  const startNewChat = () => {
    setChatId(crypto.randomUUID());
    setMessages([]);
    setThinking(null);
    setLastMemories([]);
    setExpandedMsg(null);
  };

  const loadChat = async (id: string) => {
    const res = await fetch(`/api/chats/${id}`);
    if (!res.ok) return;
    const chat = await res.json();
    setChatId(id);
    setMessages(chat.messages.map((m: { id: string; role: string; content: string }) => ({
      id: m.id, role: m.role, content: m.content,
    })));
    setThinking(null);
    setLastMemories([]);
    setExpandedMsg(null);
  };

  return (
    <div style={{ display: "flex", height: "100dvh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Sidebar */}
      <div style={{
        width: 240, borderRight: "1px solid #e5e5e5", display: "flex",
        flexDirection: "column", flexShrink: 0, backgroundColor: "#f9f9f9",
      }}>
        <div style={{ padding: "0.75rem", borderBottom: "1px solid #e5e5e5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>Chats</span>
          <button onClick={startNewChat} style={btnStyle}>+ New</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0.4rem" }}>
          {chatList.length === 0 && (
            <div style={{ color: "#bbb", fontSize: "0.8rem", padding: "1rem 0.5rem", textAlign: "center" }}>
              No conversations yet
            </div>
          )}
          {chatList.map((c) => (
            <button key={c.id} onClick={() => loadChat(c.id)} style={{
              display: "block", width: "100%", padding: "0.45rem 0.5rem", borderRadius: 6,
              border: "none", backgroundColor: c.id === chatId ? "#e0edff" : "transparent",
              textAlign: "left", cursor: "pointer", fontSize: "0.8rem", color: "#333",
              marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {c.title}
            </button>
          ))}
        </div>
        <div style={{ padding: "0.5rem", borderTop: "1px solid #e5e5e5" }}>
          <Link href="/memory" style={{
            display: "block", padding: "0.45rem", borderRadius: 6, backgroundColor: "#eef4ff",
            textAlign: "center", fontSize: "0.8rem", color: "#0070f3", textDecoration: "none", fontWeight: 500,
          }}>
            🧠 Memory Dashboard
          </Link>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "0.6rem 1rem", borderBottom: "1px solid #e5e5e5", flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>db0 Chat Agent</div>
          <div style={{ color: "#999", fontSize: "0.75rem" }}>Memory persists across conversations</div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "1rem" }}>
          {messages.length === 0 && !thinking && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", color: "#aaa", fontSize: "0.9rem", lineHeight: 1.8 }}>
              <div>
                <p style={{ margin: "0 0 0.25rem" }}>Try saying:</p>
                <p style={{ fontStyle: "italic", color: "#777", margin: "0 0 1rem" }}>
                  &quot;My name is Alice and I always use TypeScript&quot;
                </p>
                <p style={{ fontSize: "0.8rem", color: "#bbb", margin: 0 }}>
                  Then click <strong>+ New</strong> and ask &quot;What do you know about me?&quot;
                </p>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {messages.map((m, idx) => {
              const isLastAssistant = m.role === "assistant" && idx === messages.length - 1;
              const showAttribution = isLastAssistant && lastMemories.length > 0 && status !== "streaming";

              return (
                <div key={m.id}>
                  <div style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      padding: "0.6rem 0.9rem", borderRadius: 12, maxWidth: "80%",
                      fontSize: "0.9rem", lineHeight: 1.5,
                      ...(m.role === "user"
                        ? { backgroundColor: "#0070f3", color: "white", borderBottomRightRadius: 4, whiteSpace: "pre-wrap" as const }
                        : { backgroundColor: "#f1f1f1", color: "#333", borderBottomLeftRadius: 4 }),
                    }}>
                      {m.role === "user" ? m.content : (
                        <div className="markdown">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Memory attribution */}
                  {showAttribution && (
                    <div style={{ marginTop: "0.3rem", marginLeft: "0.25rem" }}>
                      <button onClick={() => setExpandedMsg(expandedMsg === m.id ? null : m.id)} style={{
                        background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem",
                        color: "#0070f3", padding: 0, display: "flex", alignItems: "center", gap: "0.3rem",
                      }}>
                        🧠 Based on {lastMemories.length} memor{lastMemories.length === 1 ? "y" : "ies"}
                        <span style={{ fontSize: "0.6rem" }}>{expandedMsg === m.id ? "▲" : "▼"}</span>
                      </button>
                      {expandedMsg === m.id && (
                        <div style={{
                          marginTop: "0.3rem", display: "flex", flexDirection: "column",
                          gap: "0.3rem", maxWidth: "80%",
                        }}>
                          {lastMemories.map((mem) => (
                            <MemoryCard key={mem.id} mem={mem} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Thinking process */}
            {thinking && thinking.step !== "done" && (
              <div style={{
                padding: "0.6rem 0.9rem", borderRadius: 12, backgroundColor: "#f8faff",
                border: "1px solid #e0e8f0", alignSelf: "flex-start", maxWidth: "80%",
                fontSize: "0.85rem", color: "#555",
              }}>
                {thinking.step === "searching" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <Spinner /> <span>Searching memory...</span>
                  </div>
                )}
                {thinking.step === "found" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
                      <span>🧠</span>
                      <span style={{ fontWeight: 500 }}>
                        Found {thinking.count} relevant memor{thinking.count === 1 ? "y" : "ies"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      {thinking.memories.slice(0, 3).map((mem) => (
                        <MemoryCard key={mem.id} mem={mem} compact />
                      ))}
                    </div>
                  </div>
                )}
                {thinking.step === "generating" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <Spinner />
                    <span>
                      Generating response
                      {thinking.count > 0 ? ` with ${thinking.count} memor${thinking.count === 1 ? "y" : "ies"}` : ""}...
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div style={{
            margin: "0 1rem", padding: "0.5rem 0.75rem", backgroundColor: "#fef2f2",
            color: "#b91c1c", fontSize: "0.8rem", borderRadius: 8, flexShrink: 0,
          }}>
            {error.message || "Something went wrong."}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{
          display: "flex", gap: "0.5rem", padding: "0.75rem 1rem",
          borderTop: "1px solid #e5e5e5", flexShrink: 0,
        }}>
          <input value={input} onChange={handleInputChange} placeholder="Say something..." autoFocus style={{
            flex: 1, padding: "0.6rem 0.75rem", borderRadius: 8,
            border: "1px solid #ddd", fontSize: "0.9rem", outline: "none",
          }} />
          <button type="submit" disabled={status === "streaming" || !input.trim()} style={{
            padding: "0.6rem 1.25rem", borderRadius: 8, border: "none",
            backgroundColor: "#0070f3", color: "white", fontSize: "0.9rem",
            cursor: status === "streaming" || !input.trim() ? "not-allowed" : "pointer",
            opacity: status === "streaming" || !input.trim() ? 0.4 : 1,
          }}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function MemoryCard({ mem, compact }: { mem: MemoryUsed; compact?: boolean }) {
  return (
    <div style={{
      padding: compact ? "0.3rem 0.4rem" : "0.4rem 0.5rem",
      borderRadius: 6, backgroundColor: "white", border: "1px solid #e8eef5",
      fontSize: compact ? "0.75rem" : "0.8rem", lineHeight: 1.4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.1rem" }}>
        <span style={{
          fontSize: "0.55rem", padding: "0.08rem 0.25rem", borderRadius: 3,
          backgroundColor: SCOPE_COLORS[mem.scope] ?? "#999",
          color: "white", fontWeight: 600, textTransform: "uppercase",
        }}>
          {mem.scope}
        </span>
        <span style={{ fontSize: "0.6rem", color: "#bbb", marginLeft: "auto" }}>
          {(mem.score * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ color: "#444" }}>{mem.content}</div>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 12, height: 12,
      border: "2px solid #ddd", borderTopColor: "#0070f3",
      borderRadius: "50%", animation: "spin 0.6s linear infinite",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </span>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "0.3rem 0.6rem", borderRadius: 6, border: "1px solid #ddd",
  backgroundColor: "white", fontSize: "0.8rem", cursor: "pointer",
};
