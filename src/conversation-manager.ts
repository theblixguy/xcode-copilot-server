import { randomUUID } from "node:crypto";
import type { CopilotSession } from "@github/copilot-sdk";
import { ToolBridgeState } from "./tool-bridge/state.js";
import type { AnthropicMessage } from "./schemas/anthropic.js";
import type { Logger } from "./logger.js";

export interface Conversation {
  id: string;
  state: ToolBridgeState;
  session: CopilotSession | null;
  sentMessageCount: number;
  isPrimary: boolean;
  model: string | null;
}

export class ConversationManager {
  private readonly conversations = new Map<string, Conversation>();
  private readonly logger: Logger;
  private primaryId: string | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  create(options?: { isPrimary?: boolean }): Conversation {
    const id = randomUUID();
    const isPrimary = options?.isPrimary ?? false;
    const state = new ToolBridgeState();
    const conversation: Conversation = {
      id,
      state,
      session: null,
      sentMessageCount: 0,
      isPrimary,
      model: null,
    };
    this.conversations.set(id, conversation);

    if (!isPrimary) {
      state.onSessionEnd(() => {
        this.logger.debug(`Conversation ${id} session ended, removing`);
        this.conversations.delete(id);
      });
    }

    if (isPrimary) {
      this.primaryId = id;
    }

    this.logger.debug(`Created conversation ${id} (primary=${String(isPrimary)}, active: ${String(this.conversations.size)})`);
    return conversation;
  }

  getPrimary(): Conversation | null {
    if (!this.primaryId) return null;
    return this.conversations.get(this.primaryId) ?? null;
  }

  clearPrimary(): void {
    if (this.primaryId) {
      const conv = this.conversations.get(this.primaryId);
      if (conv) {
        conv.state.cleanup();
        this.conversations.delete(this.primaryId);
        this.logger.debug(`Cleared primary conversation ${this.primaryId} (active: ${String(this.conversations.size)})`);
      }
      this.primaryId = null;
    }
  }

  findForNewRequest(): { conversation: Conversation; isReuse: boolean } {
    const primary = this.getPrimary();
    if (primary) {
      if (primary.state.sessionActive || !primary.session) {
        this.logger.debug(`Primary ${primary.id} is unavailable, creating isolated conversation`);
        return { conversation: this.create(), isReuse: false };
      }
      this.logger.debug(`Reusing primary conversation ${primary.id}`);
      return { conversation: primary, isReuse: true };
    }
    return { conversation: this.create({ isPrimary: true }), isReuse: false };
  }

  findByContinuation(messages: AnthropicMessage[]): Conversation | undefined {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || typeof lastMsg.content === "string") {
      return undefined;
    }

    const toolUseIds: string[] = [];
    for (const block of lastMsg.content) {
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

    // the model sometimes retries a tool after an internal failure so the
    // tool_use_id won't match anything, but we can still route by session
    for (const [, conv] of this.conversations) {
      if (conv.state.sessionActive) {
        this.logger.debug(`Continuation matched conversation ${conv.id} via sessionActive fallback`);
        return conv;
      }
    }

    return undefined;
  }

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
      if (convId === this.primaryId) {
        this.primaryId = null;
      }
      this.logger.debug(`Removed conversation ${convId} (active: ${String(this.conversations.size)})`);
    }
  }

  get size(): number {
    return this.conversations.size;
  }
}
