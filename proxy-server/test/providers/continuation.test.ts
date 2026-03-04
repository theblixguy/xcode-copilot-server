import { describe, it, expect, vi } from "vitest";
import { Logger } from "copilot-sdk-proxy";
import { handleContinuation } from "../../src/providers/shared/continuation.js";
import type { Conversation } from "../../src/conversation-manager.js";
import { ToolBridgeState } from "../../src/tool-bridge/state.js";
import { EventEmitter } from "node:events";

const logger = new Logger("none");

function createMockConversation(): Conversation {
  const state = new ToolBridgeState();
  return {
    id: "test-conv",
    state,
    session: null,
    sentMessageCount: 0,
    isPrimary: false,
    model: null,
    get sessionActive() { return state.session.sessionActive; },
    set sessionActive(active: boolean) {
      if (active) state.session.markSessionActive(); else state.session.markSessionInactive();
    },
    get hadError() { return state.session.hadError; },
    set hadError(errored: boolean) { if (errored) state.session.markSessionErrored(); },
  };
}

function createMockReply() {
  const raw = new EventEmitter();
  return {
    raw,
    _mock: true,
  } as unknown as import("fastify").FastifyReply;
}

describe("handleContinuation", () => {
  it("calls startStream and resolveResults in order", async () => {
    const conv = createMockConversation();
    const reply = createMockReply();
    const order: string[] = [];

    const startStream = vi.fn(() => { order.push("start"); });
    const resolveResults = vi.fn(() => {
      order.push("resolve");
      queueMicrotask(() => { conv.state.replies.notifyStreamingDone(); });
    });
    const countMessages = vi.fn(() => 3);

    const result = await handleContinuation(conv, reply, logger, { startStream, resolveResults, countMessages });

    expect(result).toBe(true);
    expect(order).toEqual(["start", "resolve"]);
    expect(conv.sentMessageCount).toBe(3);
  });

  it("sets the reply on the state", async () => {
    const conv = createMockConversation();
    const reply = createMockReply();

    const resolveResults = vi.fn(() => {
      queueMicrotask(() => { conv.state.replies.notifyStreamingDone(); });
    });

    await handleContinuation(conv, reply, logger, { startStream: vi.fn(), resolveResults, countMessages: () => 1 });

    expect(conv.sentMessageCount).toBe(1);
  });

  it("returns false when conversation is already actively streaming", async () => {
    const conv = createMockConversation();
    const reply = createMockReply();

    conv.state.session.markSessionActive();

    const result = await handleContinuation(conv, reply, logger, {
      startStream: vi.fn(),
      resolveResults: vi.fn(),
      countMessages: () => 1,
    });

    expect(result).toBe(false);
  });

  it("always returns true", async () => {
    const conv = createMockConversation();
    const reply = createMockReply();

    const resolveResults = vi.fn(() => {
      queueMicrotask(() => { conv.state.replies.notifyStreamingDone(); });
    });

    const result = await handleContinuation(conv, reply, logger, { startStream: vi.fn(), resolveResults, countMessages: () => 5 });
    expect(result).toBe(true);
  });
});
