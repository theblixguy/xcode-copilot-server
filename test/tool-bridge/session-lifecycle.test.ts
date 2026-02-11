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

  describe("markSessionInactive", () => {
    it("rejects all pending tool calls", async () => {
      const { router, session } = create();
      router.registerExpected("tc-1", "Read");
      const promise = new Promise<string>((resolve, reject) => {
        router.registerMCPRequest("Read", resolve, reject);
      });

      session.markSessionActive();
      session.markSessionInactive();

      await expect(promise).rejects.toThrow("Session ended");
    });

    it("clears expected queue", () => {
      const { router, session } = create();
      router.registerExpected("tc-1", "Read");
      router.registerExpected("tc-2", "Write");
      session.markSessionInactive();
      expect(router.hasExpectedTool("Read")).toBe(false);
      expect(router.hasExpectedTool("Write")).toBe(false);
      expect(router.hasPending).toBe(false);
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
      router.registerExpected("tc-1", "Read");
      router.registerExpected("tc-2", "Write");
      session.markSessionActive();

      session.cleanup();
      expect(session.sessionActive).toBe(false);
      expect(router.hasPending).toBe(false);
      expect(router.hasExpectedTool("Read")).toBe(false);
    });
  });
});
