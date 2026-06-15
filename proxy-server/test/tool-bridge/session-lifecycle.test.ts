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

  describe("status", () => {
    it("starts idle and follows the active and error transitions", () => {
      const { session } = create();
      expect(session.status).toBe("idle");

      session.markSessionActive();
      expect(session.status).toBe("active");

      session.markSessionInactive();
      expect(session.status).toBe("idle");

      session.markSessionErrored();
      expect(session.status).toBe("errored");
    });

    // The SDK sets hadError, then sets sessionActive to false in a finally
    // block. Going inactive must not wipe the error the caller is about to read.
    it("keeps an errored status when the session goes inactive", () => {
      const { session } = create();
      session.markSessionActive();
      session.markSessionErrored();
      session.markSessionInactive();

      expect(session.status).toBe("errored");
      expect(session.hadError).toBe(true);
      expect(session.sessionActive).toBe(false);
    });

    it("keeps an errored status through cleanup", () => {
      const { session } = create();
      session.markSessionErrored();
      session.cleanup();

      expect(session.hadError).toBe(true);
    });

    it("clears a previous error when a new cycle starts", () => {
      const { session } = create();
      session.markSessionErrored();
      session.markSessionActive();

      expect(session.status).toBe("active");
      expect(session.hadError).toBe(false);
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
