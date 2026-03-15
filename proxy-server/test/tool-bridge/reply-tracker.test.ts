import { describe, it, expect } from "vitest";
import { ReplyTracker } from "../../src/tool-bridge/reply-tracker.js";

describe("ReplyTracker", () => {
  describe("reply tracking", () => {
    it("starts with no reply", () => {
      expect(new ReplyTracker().currentReply).toBeNull();
    });

    it("tracks set and clear", () => {
      const tracker = new ReplyTracker();
      const fakeReply = {} as Parameters<typeof tracker.setReply>[0];
      tracker.setReply(fakeReply);
      expect(tracker.currentReply).toBe(fakeReply);
      tracker.clearReply();
      expect(tracker.currentReply).toBeNull();
    });
  });

  describe("streaming lifecycle", () => {
    it("waitForStreamingDone resolves when notifyStreamingDone is called", async () => {
      const tracker = new ReplyTracker();
      const promise = tracker.waitForStreamingDone();
      tracker.notifyStreamingDone();
      await expect(promise).resolves.toBeUndefined();
    });

    it("notifyStreamingDone is safe to call without a waiter", () => {
      const tracker = new ReplyTracker();
      expect(() => {
        tracker.notifyStreamingDone();
      }).not.toThrow();
    });

    it("supports multiple concurrent waiters", async () => {
      const tracker = new ReplyTracker();
      const p1 = tracker.waitForStreamingDone();
      const p2 = tracker.waitForStreamingDone();

      tracker.notifyStreamingDone();

      await expect(p1).resolves.toBeUndefined();
      await expect(p2).resolves.toBeUndefined();
    });
  });
});
