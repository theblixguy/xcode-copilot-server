import { describe, it, expect, vi } from "vitest";
import { ToolRouter } from "../../src/tool-bridge/tool-router.js";
import { SessionLifecycle } from "../../src/tool-bridge/session-lifecycle.js";

function create() {
  const router = new ToolRouter();
  const session = new SessionLifecycle(router);
  return { router, session };
}

describe("SessionLifecycle", () => {
  describe("session active state", () => {
    it("tracks active state via markSessionActive / markSessionInactive", () => {
      const { session } = create();
      expect(session.sessionActive).toBe(false);
      session.markSessionActive();
      expect(session.sessionActive).toBe(true);
      session.markSessionInactive();
      expect(session.sessionActive).toBe(false);
    });

    it("tracks error state via markSessionErrored", () => {
      const { session } = create();
      expect(session.hadError).toBe(false);
      session.markSessionErrored();
      expect(session.hadError).toBe(true);
    });
  });

  describe("markSessionActive", () => {
    it("clears stale entries from a previous abandoned cycle", () => {
      const { router, session } = create();
      session.markSessionActive();
      router.registerExpected("stale-tc", "Read");
      session.markSessionInactive();

      session.markSessionActive();
      expect(router.hasExpectedTool("Read")).toBe(false);
      expect(router.hasPending).toBe(false);
    });

    it("stale cleanup prevents wrong FIFO binding on reuse", () => {
      const { router, session } = create();
      session.markSessionActive();
      router.registerExpected("stale-tc", "Read");
      session.markSessionInactive();

      session.markSessionActive();
      router.registerExpected("new-tc", "Read");

      const resolve = vi.fn();
      router.registerMCPRequest("Read", resolve, vi.fn());
      router.resolveToolCall("new-tc", "file contents");
      expect(resolve).toHaveBeenCalledWith("file contents");
    });
  });

  describe("markSessionInactive", () => {
    it("does not reject pending tool calls", () => {
      const { router, session } = create();
      session.markSessionActive();
      router.registerExpected("tc-1", "Read");
      const resolve = vi.fn();
      router.registerMCPRequest("Read", resolve, vi.fn());

      session.markSessionInactive();

      expect(router.hasPendingToolCall("tc-1")).toBe(true);
      router.resolveToolCall("tc-1", "ok");
      expect(resolve).toHaveBeenCalledWith("ok");
    });

    it("preserves expected queue", () => {
      const { router, session } = create();
      session.markSessionActive();
      router.registerExpected("tc-1", "Read");
      router.registerExpected("tc-2", "Write");
      session.markSessionInactive();
      expect(router.hasExpectedTool("Read")).toBe(true);
      expect(router.hasExpectedTool("Write")).toBe(true);
      expect(router.hasPending).toBe(true);
    });
  });

  describe("onSessionEnd callback", () => {
    it("fires when markSessionInactive is called", () => {
      const { session } = create();
      const callback = vi.fn();
      session.onSessionEnd(callback);
      session.markSessionInactive();
      expect(callback).toHaveBeenCalledOnce();
    });

    it("fires when cleanup is called", () => {
      const { session } = create();
      const callback = vi.fn();
      session.onSessionEnd(callback);
      session.cleanup();
      expect(callback).toHaveBeenCalledOnce();
    });

    it("is cleared after firing (not called twice)", () => {
      const { session } = create();
      const callback = vi.fn();
      session.onSessionEnd(callback);
      session.markSessionInactive();
      session.markSessionInactive();
      expect(callback).toHaveBeenCalledOnce();
    });
  });

  describe("cleanup", () => {
    it("rejects all pending with 'Session cleanup' error", async () => {
      const { router, session } = create();
      router.registerExpected("tc-1", "Read");
      const promise = new Promise<string>((resolve, reject) => {
        router.registerMCPRequest("Read", resolve, reject);
      });

      session.cleanup();
      await expect(promise).rejects.toThrow("Session cleanup");
    });

    it("clears all state", () => {
      const { router, session } = create();
      session.markSessionActive();
      router.registerExpected("tc-1", "Read");
      router.registerExpected("tc-2", "Write");

      session.cleanup();
      expect(session.sessionActive).toBe(false);
      expect(router.hasPending).toBe(false);
      expect(router.hasExpectedTool("Read")).toBe(false);
    });
  });
});
