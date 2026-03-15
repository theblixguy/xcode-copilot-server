import { describe, it, expect, vi } from "vitest";
import { ToolBridgeState } from "../../src/tool-bridge/state.js";

describe("ToolBridgeState", () => {
  it("exposes toolCache for caching and resolving tools", () => {
    const state = new ToolBridgeState();
    const tools = [
      {
        name: "Read",
        description: "",
        input_schema: { type: "object" as const, properties: {} },
      },
    ];
    state.toolCache.cacheTools(tools);
    expect(state.toolCache.getCachedTools()).toBe(tools);
    expect(state.toolCache.resolveToolName("Read")).toBe("Read");
  });

  it("exposes toolRouter for pending tool calls", () => {
    const state = new ToolBridgeState();
    state.toolRouter.registerExpected("tc-1", "Read");
    expect(state.toolRouter.hasPendingToolCall("tc-1")).toBe(true);
    expect(state.toolRouter.hasExpectedTool("Read")).toBe(true);
    expect(state.toolRouter.hasPending).toBe(true);

    const resolve = vi.fn();
    state.toolRouter.registerMCPRequest("Read", resolve, () => {});
    state.toolRouter.resolveToolCall("tc-1", "ok");
    expect(resolve).toHaveBeenCalledWith("ok");
    expect(state.toolRouter.hasPending).toBe(false);
  });

  it("exposes replies for streaming signals", async () => {
    const state = new ToolBridgeState();
    expect(state.replies.currentReply).toBeNull();

    const promise = state.replies.waitForStreamingDone();
    state.replies.notifyStreamingDone();
    await expect(promise).resolves.toBeUndefined();
  });

  it("exposes session for lifecycle tracking", () => {
    const state = new ToolBridgeState();
    expect(state.session.sessionActive).toBe(false);
    state.session.markSessionActive();
    expect(state.session.sessionActive).toBe(true);
    state.session.markSessionInactive();
    expect(state.session.sessionActive).toBe(false);
  });

  it("markSessionInactive does not reject pending tool calls", () => {
    const state = new ToolBridgeState();
    state.session.markSessionActive();
    state.toolRouter.registerExpected("tc-1", "Read");
    const resolve = vi.fn();
    state.toolRouter.registerMCPRequest("Read", resolve, vi.fn());

    state.session.markSessionInactive();

    expect(state.toolRouter.hasPending).toBe(true);
    state.toolRouter.resolveToolCall("tc-1", "ok");
    expect(resolve).toHaveBeenCalledWith("ok");
  });

  it("cleanup rejects pending tool calls", async () => {
    const state = new ToolBridgeState();
    state.session.markSessionActive();
    state.toolRouter.registerExpected("tc-1", "Read");
    const promise = new Promise<string>((resolve, reject) => {
      state.toolRouter.registerMCPRequest("Read", resolve, reject);
    });

    state.session.cleanup();

    await expect(promise).rejects.toThrow("Session cleanup");
    expect(state.toolRouter.hasPending).toBe(false);
  });

  it("cleanup fires onSessionEnd callback", () => {
    const state = new ToolBridgeState();
    const callback = vi.fn();
    state.session.onSessionEnd(callback);
    state.session.cleanup();
    expect(callback).toHaveBeenCalledOnce();
  });
});
