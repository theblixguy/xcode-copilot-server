import { describe, it, expect, vi } from "vitest";
import { ToolBridgeState } from "../../src/tool-bridge/state.js";

describe("ToolBridgeState (facade integration)", () => {
  it("delegates tool caching to ToolCache", () => {
    const state = new ToolBridgeState();
    const tools = [
      { name: "Read", description: "", input_schema: { type: "object" as const, properties: {} } },
    ];
    state.cacheTools(tools);
    expect(state.getCachedTools()).toBe(tools);
    expect(state.resolveToolName("Read")).toBe("Read");
  });

  it("delegates tool routing to ToolRouter", () => {
    const state = new ToolBridgeState();
    state.registerExpected("tc-1", "Read");
    expect(state.hasPendingToolCall("tc-1")).toBe(true);
    expect(state.hasExpectedTool("Read")).toBe(true);
    expect(state.hasPending).toBe(true);

    const resolve = vi.fn();
    state.registerMCPRequest("Read", resolve, () => {});
    state.resolveToolCall("tc-1", "ok");
    expect(resolve).toHaveBeenCalledWith("ok");
    expect(state.hasPending).toBe(false);
  });

  it("delegates streaming to ReplyTracker", async () => {
    const state = new ToolBridgeState();
    expect(state.currentReply).toBeNull();

    const promise = state.waitForStreamingDone();
    state.notifyStreamingDone();
    await expect(promise).resolves.toBeUndefined();
  });

  it("delegates session lifecycle to SessionLifecycle", () => {
    const state = new ToolBridgeState();
    expect(state.sessionActive).toBe(false);
    state.markSessionActive();
    expect(state.sessionActive).toBe(true);
    state.markSessionInactive();
    expect(state.sessionActive).toBe(false);
  });

  it("markSessionInactive rejects pending tool calls (cross-concern)", async () => {
    const state = new ToolBridgeState();
    state.registerExpected("tc-1", "Read");
    const promise = new Promise<string>((resolve, reject) => {
      state.registerMCPRequest("Read", resolve, reject);
    });

    state.markSessionActive();
    state.markSessionInactive();

    await expect(promise).rejects.toThrow("Session ended");
    expect(state.hasPending).toBe(false);
  });

  it("cleanup fires onSessionEnd callback", () => {
    const state = new ToolBridgeState();
    const callback = vi.fn();
    state.onSessionEnd(callback);
    state.cleanup();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("exposes sub-objects as public properties", () => {
    const state = new ToolBridgeState();
    expect(state.toolCache).toBeDefined();
    expect(state.toolRouter).toBeDefined();
    expect(state.replyTracker).toBeDefined();
    expect(state.session).toBeDefined();
  });
});
