import { randomUUID } from "node:crypto";
import { ToolBridgeState } from "./tool-bridge/state.js";
import type {
  Conversation as CoreConversation,
  Logger,
} from "copilot-sdk-proxy";

export interface Conversation extends CoreConversation {
  state: ToolBridgeState;
}

// Used by MCP routes for state lookups without full ConversationManager access.
export interface ToolStateProvider {
  getState(convId: string): ToolBridgeState | undefined;
  findByExpectedTool(name: string): ToolBridgeState | undefined;
}

function isConversation(conv: CoreConversation): conv is Conversation {
  return (
    "state" in conv &&
    (conv as { state: unknown }).state instanceof ToolBridgeState
  );
}

export function asConversation(conv: CoreConversation): Conversation {
  if (!isConversation(conv))
    throw new Error("Expected extended Conversation with state");
  return conv;
}

export class ConversationManager implements ToolStateProvider {
  private readonly conversations = new Map<string, Conversation>();
  private readonly logger: Logger;
  private readonly toolBridgeTimeoutMs: number;
  private primaryId: string | null = null;

  constructor(logger: Logger, toolBridgeTimeoutMs = 0) {
    this.logger = logger;
    this.toolBridgeTimeoutMs = toolBridgeTimeoutMs;
  }

  create(options?: { isPrimary?: boolean }): Conversation {
    const id = randomUUID();
    const isPrimary = options?.isPrimary ?? false;
    const state = new ToolBridgeState(this.toolBridgeTimeoutMs);
    const conversation: Conversation = {
      id,
      state,
      session: null,
      sentMessageCount: 0,
      isPrimary,
      model: null,
      get sessionActive() {
        return state.session.sessionActive;
      },
      set sessionActive(active: boolean) {
        if (active) {
          state.session.markSessionActive();
        } else {
          state.session.markSessionInactive();
        }
      },
      get hadError() {
        return state.session.hadError;
      },
      set hadError(errored: boolean) {
        if (errored) state.session.markSessionErrored();
      },
    };
    this.conversations.set(id, conversation);

    if (isPrimary) {
      this.primaryId = id;
    }

    this.logger.debug(
      `Created conversation ${id} (primary=${String(isPrimary)})`,
    );
    return conversation;
  }

  getPrimary(): Conversation | undefined {
    if (!this.primaryId) return undefined;
    return this.conversations.get(this.primaryId);
  }

  clearPrimary(): void {
    if (this.primaryId) {
      const conv = this.conversations.get(this.primaryId);
      if (conv) {
        conv.state.session.cleanup();
        this.conversations.delete(this.primaryId);
        this.logger.debug(`Cleared primary conversation ${this.primaryId}`);
      }
      this.primaryId = null;
    }
  }

  // A conversation can be removed once no future request can route to it. That
  // means it is not the primary, its session is idle, and no tool calls are
  // pending. The bridge sends tools/call just after the session goes idle, so
  // the pending check keeps an isolated conversation alive to answer them.
  private isDisposable(conv: Conversation): boolean {
    return (
      !conv.isPrimary &&
      !conv.state.session.sessionActive &&
      !conv.state.toolRouter.hasPending
    );
  }

  private evictDisposable(): void {
    for (const [id, conv] of this.conversations) {
      if (this.isDisposable(conv)) {
        conv.state.session.cleanup();
        this.conversations.delete(id);
        this.logger.debug(`Evicted idle conversation ${id}`);
      }
    }
  }

  findForNewRequest(): { conversation: Conversation; isReuse: boolean } {
    this.evictDisposable();

    const primary = this.getPrimary();
    if (primary) {
      if (primary.state.session.sessionActive) {
        this.logger.debug(
          `Primary ${primary.id} is busy, creating isolated conversation`,
        );
        return { conversation: this.create(), isReuse: false };
      }
      if (primary.state.toolRouter.hasPending) {
        this.logger.debug(
          `Primary ${primary.id} has pending tool calls, creating isolated conversation`,
        );
        return { conversation: this.create(), isReuse: false };
      }
      if (!primary.session) {
        // No SDK session yet. Create an isolated conversation so the primary
        // stays available for the first real request.
        this.logger.debug(
          `Primary ${primary.id} has no session, creating isolated conversation`,
        );
        return { conversation: this.create(), isReuse: false };
      }
      this.logger.debug(`Reusing primary conversation ${primary.id}`);
      return { conversation: primary, isReuse: true };
    }
    return { conversation: this.create({ isPrimary: true }), isReuse: false };
  }

  findByContinuationIds(callIds: string[]): Conversation | undefined {
    if (callIds.length === 0) return undefined;

    for (const [, conv] of this.conversations) {
      for (const callId of callIds) {
        if (conv.state.toolRouter.hasPendingToolCall(callId)) {
          this.logger.debug(
            `Continuation matched conversation ${conv.id} via call_id ${callId}`,
          );
          return conv;
        }
      }
    }

    for (const [, conv] of this.conversations) {
      if (conv.state.session.sessionActive) {
        this.logger.debug(
          `Continuation matched conversation ${conv.id} via sessionActive fallback`,
        );
        return conv;
      }
    }

    return undefined;
  }

  findByExpectedTool(name: string): ToolBridgeState | undefined {
    for (const [, conv] of this.conversations) {
      if (conv.state.toolRouter.hasExpectedTool(name)) {
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
      conv.state.session.cleanup();
      this.conversations.delete(convId);
      if (convId === this.primaryId) {
        this.primaryId = null;
      }
      this.logger.debug(`Removed conversation ${convId}`);
    }
  }

  get size(): number {
    return this.conversations.size;
  }
}
