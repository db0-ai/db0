/**
 * db0-backed chat message history for LangChain.js.
 *
 * Implements BaseChatMessageHistory so it can be used with
 * RunnableWithMessageHistory or any chain that expects message history.
 *
 * Unlike LangChain's built-in memory classes (deprecated in v0.3.1),
 * this stores messages in db0's scoped memory system with automatic
 * fact extraction.
 *
 * Usage:
 *   import { Db0ChatMessageHistory } from "@db0-ai/langchain";
 *
 *   const history = new Db0ChatMessageHistory({ harness });
 *   await history.addUserMessage("I prefer dark mode");
 *   const messages = await history.getMessages();
 */

import { BaseListChatMessageHistory } from "@langchain/core/chat_history";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import type { Harness } from "@db0-ai/core";

export interface Db0ChatMessageHistoryOptions {
  /** db0 harness instance */
  harness: Harness;
  /** Whether to extract facts from messages automatically. Default: true */
  extractFacts?: boolean;
}

export class Db0ChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ["db0", "chat_history"];

  private harness: Harness;
  private messages: BaseMessage[] = [];
  private extractFacts: boolean;

  constructor(options: Db0ChatMessageHistoryOptions) {
    super();
    this.harness = options.harness;
    this.extractFacts = options.extractFacts ?? true;
  }

  async getMessages(): Promise<BaseMessage[]> {
    return this.messages;
  }

  async addMessage(message: BaseMessage): Promise<void> {
    this.messages.push(message);

    // Extract facts from the message content
    if (this.extractFacts && typeof message.content === "string") {
      const extraction = this.harness.extraction();
      const facts = await extraction.extract(message.content);
      for (const fact of facts) {
        await this.harness.context().ingest(fact.content, {
          scope: fact.scope,
          tags: fact.tags,
        });
      }
    }

    // Log the message
    await this.harness.log().append({
      event: message._getType() === "human" ? "user.message" : "assistant.message",
      level: "info",
      data: {
        content:
          typeof message.content === "string"
            ? message.content.slice(0, 200)
            : "(non-string content)",
      },
    });
  }

  async addUserMessage(message: string): Promise<void> {
    await this.addMessage(new HumanMessage(message));
  }

  async addAIMessage(message: string): Promise<void> {
    await this.addMessage(new AIMessage(message));
  }

  async clear(): Promise<void> {
    this.messages = [];
  }
}
