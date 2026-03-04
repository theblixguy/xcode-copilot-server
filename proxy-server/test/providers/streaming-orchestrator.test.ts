import { describe, it, expect, vi } from "vitest";
import { Logger } from "copilot-sdk-proxy";
import { orchestrateStreaming } from "../../src/providers/shared/streaming-orchestrator.js";
import { ConversationManager } from "../../src/conversation-manager.js";

const logger = new Logger("none");

function createContext(overrides: {
  isPrimary?: boolean;
  hadError?: boolean;
  runStreaming?: () => Promise<void>;
  messageCount?: number;
}) {
  const manager = new ConversationManager(logger);
  const conversation = manager.create({
    isPrimary: overrides.isPrimary ?? true,
  });
  if (overrides.hadError) {
    conversation.state.session.markSessionErrored();
  }
  return {
    conversation,
    session: {} as never,
    prompt: "test prompt",
    model: "test-model",
    logger,
    config: {} as never,
    stats: {} as never,
    manager,
    messageCount: overrides.messageCount ?? 5,
    tools: undefined,
    runStreaming: overrides.runStreaming ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("orchestrateStreaming", () => {
  it("calls runStreaming and updates sentMessageCount", async () => {
    const ctx = createContext({ messageCount: 10 });
    await orchestrateStreaming(ctx);

    expect(ctx.runStreaming).toHaveBeenCalledTimes(1);
    expect(ctx.conversation.sentMessageCount).toBe(10);
  });

  it("clears primary when isPrimary and session had error", async () => {
    const ctx = createContext({ isPrimary: true });
    const clearSpy = vi.spyOn(ctx.manager, "clearPrimary");

    ctx.runStreaming = vi.fn(() => {
      ctx.conversation.state.session.markSessionErrored();
      return Promise.resolve();
    });

    await orchestrateStreaming(ctx);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("does not clear primary when no error", async () => {
    const ctx = createContext({ isPrimary: true });
    const clearSpy = vi.spyOn(ctx.manager, "clearPrimary");

    await orchestrateStreaming(ctx);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("does not clear primary for non-primary conversations even on error", async () => {
    const ctx = createContext({ isPrimary: false });
    const clearSpy = vi.spyOn(ctx.manager, "clearPrimary");

    ctx.runStreaming = vi.fn(() => {
      ctx.conversation.state.session.markSessionErrored();
      return Promise.resolve();
    });

    await orchestrateStreaming(ctx);
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
