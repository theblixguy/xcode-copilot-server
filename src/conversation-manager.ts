import { randomUUID } from "node:crypto";
import type { CopilotSession } from "@github/copilot-sdk";
import { ToolBridgeState } from "./tool-bridge/state.js";
import type { AnthropicMessage, ContentBlock } from "./schemas/anthropic.js";
import type { Logger } from "./logger.js";

export interface Conversation {
  id: string;
  state: ToolBridgeState;
  session: CopilotSession | null;
  sentMessageCount: number;
}

export class ConversationManager {
  private readonly conversations = new Map<string, Conversation>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  create(): Conversation {
    const id = randomUUID();
    const state = new ToolBridgeState();
    const conversation: Conversation = {
      id,
      state,
      session: null,
      sentMessageCount: 0,
    };
    this.conversations.set(id, conversation);

    state.onSessionEnd(() => {
      this.logger.debug(`Conversation ${id} session ended, removing`);
      this.conversations.delete(id);
    });

    this.logger.debug(`Created conversation ${id} (active: ${String(this.conversations.size)})`);
    return conversation;
  }

  /**
   * Find a conversation that owns the tool_result blocks in the incoming
   * messages. Returns undefined if no match (meaning this is a new request).
   */
  findByContinuation(messages: AnthropicMessage[]): Conversation | undefined {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || typeof lastMsg.content === "string") {
      return undefined;
    }

    const toolUseIds: string[] = [];
    for (const block of lastMsg.content as ContentBlock[]) {
      if (block.type === "tool_result") {
        toolUseIds.push(block.tool_use_id);
      }
    }

    if (toolUseIds.length === 0) return undefined;

    for (const [, conv] of this.conversations) {
      for (const toolUseId of toolUseIds) {
        if (conv.state.hasPendingToolCall(toolUseId)) {
          this.logger.debug(`Continuation matched conversation ${conv.id} via tool_use_id ${toolUseId}`);
          return conv;
        }
      }
    }

    // Fallback: if no tool_result match, check for any conversation with
    // sessionActive (e.g. the model retried a tool after an internal failure).
    for (const [, conv] of this.conversations) {
      if (conv.state.sessionActive) {
        this.logger.debug(`Continuation matched conversation ${conv.id} via sessionActive fallback`);
        return conv;
      }
    }

    return undefined;
  }

  /**
   * Find a conversation state that expects a tool call with the given name.
   * Used by POST /internal/:convId/tool-call fallback routing.
   */
  findByExpectedTool(name: string): ToolBridgeState | undefined {
    for (const [, conv] of this.conversations) {
      if (conv.state.hasExpectedTool(name)) {
        return conv.state;
      }
    }
    return undefined;
  }

  getState(convId: string): ToolBridgeState | undefined {
    return this.conversations.get(convId)?.state;
  }

  remove(convId: string): void {
    const conv = this.conversations.get(convId);
    if (conv) {
      conv.state.cleanup();
      this.conversations.delete(convId);
      this.logger.debug(`Removed conversation ${convId} (active: ${String(this.conversations.size)})`);
    }
  }

  get size(): number {
    return this.conversations.size;
  }
}
