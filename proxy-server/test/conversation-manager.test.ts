import { describe, it, expect } from "vitest";
import { ConversationManager } from "../src/conversation-manager.js";
import { Logger } from "copilot-sdk-proxy";

const logger = new Logger("none");

function createManager(): ConversationManager {
  return new ConversationManager(logger);
}

describe("ConversationManager", () => {
  describe("create", () => {
    it("returns a conversation with a unique id", () => {
      const manager = createManager();
      const a = manager.create();
      const b = manager.create();
      expect(a.id).toBeTruthy();
      expect(b.id).toBeTruthy();
      expect(a.id).not.toBe(b.id);
    });

    it("initialises conversation fields", () => {
      const conv = createManager().create();
      expect(conv.session).toBeNull();
      expect(conv.sentMessageCount).toBe(0);
      expect(conv.state).toBeDefined();
      expect(conv.isPrimary).toBe(false);
    });

    it("marks conversation as primary when requested", () => {
      const conv = createManager().create({ isPrimary: true });
      expect(conv.isPrimary).toBe(true);
    });

    it("increments size", () => {
      const manager = createManager();
      expect(manager.size).toBe(0);
      manager.create();
      expect(manager.size).toBe(1);
      manager.create();
      expect(manager.size).toBe(2);
    });
  });

  describe("getState", () => {
    it("returns state for an existing conversation", () => {
      const manager = createManager();
      const conv = manager.create();
      expect(manager.getState(conv.id)).toBe(conv.state);
    });

    it("returns undefined for unknown id", () => {
      expect(createManager().getState("no-such-id")).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("removes conversation and decrements size", () => {
      const manager = createManager();
      const conv = manager.create();
      expect(manager.size).toBe(1);
      manager.remove(conv.id);
      expect(manager.size).toBe(0);
      expect(manager.getState(conv.id)).toBeUndefined();
    });

    it("is a no-op for unknown id", () => {
      const manager = createManager();
      manager.create();
      manager.remove("unknown");
      expect(manager.size).toBe(1);
    });

    it("calls cleanup on the state (rejects pending tool calls)", async () => {
      const manager = createManager();
      const conv = manager.create();

      conv.state.registerExpected("call-1", "Read");
      const resultPromise = new Promise<string>((resolve, reject) => {
        conv.state.registerMCPRequest("Read", resolve, reject);
      });

      manager.remove(conv.id);

      await expect(resultPromise).rejects.toThrow("Session cleanup");
    });
  });

  describe("findByContinuation", () => {
    it("returns undefined for empty messages", () => {
      expect(createManager().findByContinuation([])).toBeUndefined();
    });

    it("returns undefined when last message is from assistant", () => {
      const result = createManager().findByContinuation([
        { role: "assistant", content: "Hello" },
      ]);
      expect(result).toBeUndefined();
    });

    it("returns undefined when last user message is a plain string", () => {
      const result = createManager().findByContinuation([
        { role: "user", content: "Hello" },
      ]);
      expect(result).toBeUndefined();
    });

    it("returns undefined when last user message has no tool_result blocks", () => {
      const result = createManager().findByContinuation([
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ]);
      expect(result).toBeUndefined();
    });

    it("matches conversation by pending tool_use_id", () => {
      const manager = createManager();
      const conv = manager.create();

      conv.state.registerExpected("tc-123", "Read");
      conv.state.registerMCPRequest("Read", () => {}, () => {});

      const result = manager.findByContinuation([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc-123", content: "file contents" },
          ],
        },
      ]);

      expect(result).toBe(conv);
    });

    it("matches conversation by expected (not yet pending) tool_use_id", () => {
      const manager = createManager();
      const conv = manager.create();

      conv.state.registerExpected("tc-456", "Write");

      const result = manager.findByContinuation([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc-456", content: "ok" },
          ],
        },
      ]);

      expect(result).toBe(conv);
    });

    it("matches the correct conversation among multiple", () => {
      const manager = createManager();
      const conv1 = manager.create();
      const conv2 = manager.create();

      conv1.state.registerExpected("tc-aaa", "Read");
      conv2.state.registerExpected("tc-bbb", "Write");

      const result = manager.findByContinuation([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc-bbb", content: "done" },
          ],
        },
      ]);

      expect(result).toBe(conv2);
    });

    it("falls back to sessionActive when tool_result does not match any pending", () => {
      const manager = createManager();
      const conv = manager.create();
      conv.state.markSessionActive();

      const result = manager.findByContinuation([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc-unknown", content: "" },
          ],
        },
      ]);

      expect(result).toBe(conv);
    });

    it("returns undefined when tool_result does not match and no session is active", () => {
      const manager = createManager();
      manager.create(); // inactive session

      const result = manager.findByContinuation([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc-unknown", content: "" },
          ],
        },
      ]);

      expect(result).toBeUndefined();
    });
  });

  describe("findByExpectedTool", () => {
    it("finds state with expected tool", () => {
      const manager = createManager();
      const conv = manager.create();
      conv.state.registerExpected("tc-1", "Bash");

      expect(manager.findByExpectedTool("Bash")).toBe(conv.state);
    });

    it("returns undefined when no conversation expects the tool", () => {
      const manager = createManager();
      manager.create();
      expect(manager.findByExpectedTool("Bash")).toBeUndefined();
    });
  });

  describe("auto-removal via onSessionEnd", () => {
    it("removes non-primary conversation when session becomes inactive", () => {
      const manager = createManager();
      const conv = manager.create();
      conv.state.markSessionActive();

      expect(manager.size).toBe(1);
      conv.state.markSessionInactive();
      expect(manager.size).toBe(0);
      expect(manager.getState(conv.id)).toBeUndefined();
    });

    it("removes non-primary conversation on cleanup", () => {
      const manager = createManager();
      const conv = manager.create();

      expect(manager.size).toBe(1);
      conv.state.cleanup();
      expect(manager.size).toBe(0);
    });

    it("does NOT auto-remove primary conversation on session idle", () => {
      const manager = createManager();
      const conv = manager.create({ isPrimary: true });
      conv.state.markSessionActive();

      expect(manager.size).toBe(1);
      conv.state.markSessionInactive();
      expect(manager.size).toBe(1);
      expect(manager.getState(conv.id)).toBe(conv.state);
      expect(manager.getPrimary()).toBe(conv);
    });
  });

  describe("primary session", () => {
    it("getPrimary returns null when no primary exists", () => {
      expect(createManager().getPrimary()).toBeNull();
    });

    it("getPrimary returns the primary conversation", () => {
      const manager = createManager();
      const conv = manager.create({ isPrimary: true });
      expect(manager.getPrimary()).toBe(conv);
    });

    it("clearPrimary removes the primary and cleans up state", () => {
      const manager = createManager();
      const conv = manager.create({ isPrimary: true });
      expect(manager.size).toBe(1);

      manager.clearPrimary();
      expect(manager.size).toBe(0);
      expect(manager.getPrimary()).toBeNull();
      expect(manager.getState(conv.id)).toBeUndefined();
    });

    it("clearPrimary is a no-op when no primary exists", () => {
      const manager = createManager();
      manager.create();
      expect(manager.size).toBe(1);
      manager.clearPrimary();
      expect(manager.size).toBe(1);
    });

    it("remove clears primaryId when removing the primary", () => {
      const manager = createManager();
      const conv = manager.create({ isPrimary: true });
      manager.remove(conv.id);
      expect(manager.getPrimary()).toBeNull();
    });
  });

  describe("findForNewRequest", () => {
    it("creates a new primary when none exists", () => {
      const manager = createManager();
      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(false);
      expect(conversation.isPrimary).toBe(true);
      expect(manager.getPrimary()).toBe(conversation);
    });

    it("reuses idle primary with a session", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(true);
      expect(conversation).toBe(primary);
    });

    it("creates isolated conversation when primary is busy", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;
      primary.state.markSessionActive();

      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(false);
      expect(conversation.isPrimary).toBe(false);
      expect(conversation).not.toBe(primary);
      expect(manager.getPrimary()).toBe(primary);
    });

    it("creates isolated conversation when primary session is null (not yet created)", () => {
      const manager = createManager();
      manager.create({ isPrimary: true });

      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(false);
      expect(conversation.isPrimary).toBe(false);
    });

    it("evicts idle non-primary conversations", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      manager.create();
      expect(manager.size).toBe(2);

      manager.findForNewRequest();

      expect(manager.size).toBe(1);
      expect(manager.getPrimary()).toBe(primary);
    });

    it("does NOT evict active non-primary conversations", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;
      primary.state.markSessionActive();

      const isolated = manager.create();
      isolated.state.markSessionActive();
      expect(manager.size).toBe(2);

      manager.findForNewRequest();
      expect(manager.size).toBe(3);
    });

    it("calls cleanup on evicted conversations", async () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      const isolated = manager.create();
      isolated.state.registerExpected("call-1", "Read");
      const resultPromise = new Promise<string>((resolve, reject) => {
        isolated.state.registerMCPRequest("Read", resolve, reject);
      });

      manager.findForNewRequest();
      await expect(resultPromise).rejects.toThrow();
    });
  });
});
