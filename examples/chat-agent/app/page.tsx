"use client";

import { useChat } from "@ai-sdk/react";
import { useId } from "react";

export default function Chat() {
  const chatId = useId();

  const { messages, input, handleInputChange, handleSubmit, status } =
    useChat({
      api: "/api/chat",
      body: { chatId, userId: "demo-user" },
    });

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "2rem 1rem",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
      }}
    >
      <div style={{ marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>db0 Chat Agent</h1>
        <p style={{ color: "#666", fontSize: "0.875rem", margin: "0.25rem 0 0" }}>
          A chatbot that remembers across sessions. Tell it your preferences —
          start a new chat and it still knows.
        </p>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          paddingBottom: "1rem",
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: "#999", padding: "2rem 0", textAlign: "center" }}>
            <p>Try saying something like:</p>
            <p style={{ fontStyle: "italic" }}>
              &quot;My name is Alice and I always use TypeScript with strict mode&quot;
            </p>
            <p style={{ fontSize: "0.875rem", marginTop: "1rem" }}>
              Then reload the page and ask: &quot;What do you know about me?&quot;
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              padding: "0.75rem 1rem",
              borderRadius: 8,
              backgroundColor: m.role === "user" ? "#f0f0f0" : "#e8f4fd",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              whiteSpace: "pre-wrap",
            }}
          >
            <div
              style={{
                fontSize: "0.75rem",
                color: "#888",
                marginBottom: "0.25rem",
              }}
            >
              {m.role === "user" ? "You" : "Assistant"}
            </div>
            {m.content}
          </div>
        ))}

        {status === "streaming" && (
          <div style={{ color: "#999", fontSize: "0.875rem" }}>Thinking...</div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "0.5rem" }}
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Say something..."
          style={{
            flex: 1,
            padding: "0.75rem",
            borderRadius: 8,
            border: "1px solid #ddd",
            fontSize: "1rem",
          }}
        />
        <button
          type="submit"
          disabled={status === "streaming"}
          style={{
            padding: "0.75rem 1.5rem",
            borderRadius: 8,
            border: "none",
            backgroundColor: "#0070f3",
            color: "white",
            fontSize: "1rem",
            cursor: status === "streaming" ? "not-allowed" : "pointer",
            opacity: status === "streaming" ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
