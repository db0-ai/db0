"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
}

interface MemoryContext {
  count: number;
  estimatedTokens: number;
  memories: Array<{
    id: string;
    content: string;
    scope: string;
    score: number;
  }>;
}

export default function Chat() {
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [chatList, setChatList] = useState<ChatSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memoryCtx, setMemoryCtx] = useState<MemoryContext | null>(null);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, status, error, setMessages } =
    useChat({
      api: "/api/chat",
      body: { chatId, userId: "demo-user" },
      onFinish: () => {
        // Fetch which memories backed this response
        fetch(`/api/memories/context?chatId=${chatId}`)
          .then((r) => r.json())
          .then((data) => { if (data) setMemoryCtx(data); });
      },
    });

  const refreshChatList = useCallback(async () => {
    const res = await fetch("/api/chats");
    if (res.ok) setChatList(await res.json());
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(refreshChatList, 500);
      return () => clearTimeout(timer);
    }
  }, [messages.length, refreshChatList]);

  useEffect(() => {
    refreshChatList();
  }, [refreshChatList]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startNewChat = () => {
    setChatId(crypto.randomUUID());
    setMessages([]);
    setMemoryCtx(null);
  };

  const loadChat = async (id: string) => {
    const res = await fetch(`/api/chats/${id}`);
    if (!res.ok) return;
    const chat = await res.json();
    setChatId(id);
    setMessages(
      chat.messages.map((m: { id: string; role: string; content: string }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })),
    );
    // Load memory context for this chat
    fetch(`/api/memories/context?chatId=${id}`)
      .then((r) => r.json())
      .then((data) => { if (data) setMemoryCtx(data); });
  };

  return (
    <div style={{ display: "flex", height: "100dvh" }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <div
          style={{
            width: 240,
            borderRight: "1px solid #eee",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            backgroundColor: "#fafafa",
          }}
        >
          <div
            style={{
              padding: "0.75rem",
              borderBottom: "1px solid #eee",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Chats</span>
            <button
              onClick={startNewChat}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: 6,
                border: "1px solid #ddd",
                backgroundColor: "white",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              + New
            </button>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "0.5rem" }}>
            {chatList.length === 0 && (
              <div style={{ color: "#bbb", fontSize: "0.8rem", padding: "1rem 0.5rem", textAlign: "center" }}>
                No conversations yet
              </div>
            )}
            {chatList.map((c) => (
              <button
                key={c.id}
                onClick={() => loadChat(c.id)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "0.5rem 0.6rem",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: c.id === chatId ? "#e8f0fe" : "transparent",
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  color: "#333",
                  marginBottom: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.title}
              </button>
            ))}
          </div>

          <div style={{ padding: "0.5rem", borderTop: "1px solid #eee" }}>
            <Link
              href="/memory"
              style={{
                display: "block",
                padding: "0.5rem 0.6rem",
                borderRadius: 6,
                backgroundColor: "#f0f7ff",
                textAlign: "center",
                fontSize: "0.8rem",
                color: "#0070f3",
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              🧠 Memory Dashboard
            </Link>
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            padding: "0.6rem 1rem",
            borderBottom: "1px solid #eee",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: "1.1rem", padding: "0.2rem", color: "#666" }}
          >
            ☰
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>db0 Chat Agent</div>
            <div style={{ color: "#999", fontSize: "0.75rem" }}>Memory persists across conversations</div>
          </div>
          {/* Memory indicator */}
          {memoryCtx && memoryCtx.count > 0 && (
            <button
              onClick={() => setMemoryPanelOpen(!memoryPanelOpen)}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: 12,
                border: "1px solid #d4e8ff",
                backgroundColor: memoryPanelOpen ? "#0070f3" : "#f0f7ff",
                color: memoryPanelOpen ? "white" : "#0070f3",
                fontSize: "0.75rem",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              🧠 {memoryCtx.count} memor{memoryCtx.count === 1 ? "y" : "ies"} used
            </button>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {messages.length === 0 && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center", color: "#aaa", fontSize: "0.9rem", lineHeight: 1.8 }}>
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

            {messages.map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    padding: "0.6rem 0.9rem",
                    borderRadius: 12,
                    maxWidth: "80%",
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    ...(m.role === "user"
                      ? { backgroundColor: "#0070f3", color: "white", borderBottomRightRadius: 4 }
                      : { backgroundColor: "#f1f1f1", color: "#333", borderBottomLeftRadius: 4 }),
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {status === "streaming" && messages.at(-1)?.role !== "assistant" && (
              <div
                style={{
                  padding: "0.6rem 0.9rem",
                  borderRadius: 12,
                  backgroundColor: "#f1f1f1",
                  color: "#999",
                  fontSize: "0.9rem",
                  alignSelf: "flex-start",
                  borderBottomLeftRadius: 4,
                }}
              >
                Thinking...
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Memory context panel */}
          {memoryPanelOpen && memoryCtx && memoryCtx.count > 0 && (
            <div
              style={{
                width: 280,
                borderLeft: "1px solid #eee",
                overflow: "auto",
                padding: "0.75rem",
                backgroundColor: "#fafcff",
                flexShrink: 0,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.5rem", color: "#555" }}>
                Memories used for last response
              </div>
              <div style={{ fontSize: "0.7rem", color: "#999", marginBottom: "0.75rem" }}>
                {memoryCtx.count} memor{memoryCtx.count === 1 ? "y" : "ies"} · ~{memoryCtx.estimatedTokens} tokens
              </div>
              {memoryCtx.memories.map((m, i) => (
                <div
                  key={m.id}
                  style={{
                    padding: "0.5rem",
                    borderRadius: 6,
                    backgroundColor: "white",
                    border: "1px solid #e8eef5",
                    marginBottom: "0.4rem",
                    fontSize: "0.8rem",
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                    <span
                      style={{
                        fontSize: "0.6rem",
                        padding: "0.1rem 0.3rem",
                        borderRadius: 3,
                        backgroundColor: "#0070f3",
                        color: "white",
                        fontWeight: 600,
                        textTransform: "uppercase",
                      }}
                    >
                      {m.scope}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "#bbb" }}>
                      {(m.score * 100).toFixed(0)}% match
                    </span>
                  </div>
                  <div style={{ color: "#444" }}>{m.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              margin: "0 1rem",
              padding: "0.5rem 0.75rem",
              backgroundColor: "#fef2f2",
              color: "#b91c1c",
              fontSize: "0.8rem",
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            {error.message || "Something went wrong. Check the server logs."}
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            gap: "0.5rem",
            padding: "0.75rem 1rem",
            borderTop: "1px solid #eee",
            flexShrink: 0,
          }}
        >
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Say something..."
            autoFocus
            style={{
              flex: 1,
              padding: "0.6rem 0.75rem",
              borderRadius: 8,
              border: "1px solid #ddd",
              fontSize: "0.9rem",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={status === "streaming" || !input.trim()}
            style={{
              padding: "0.6rem 1.25rem",
              borderRadius: 8,
              border: "none",
              backgroundColor: "#0070f3",
              color: "white",
              fontSize: "0.9rem",
              cursor: status === "streaming" || !input.trim() ? "not-allowed" : "pointer",
              opacity: status === "streaming" || !input.trim() ? 0.4 : 1,
            }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
