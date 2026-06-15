import { describe, it, expect, vi } from "vitest";
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

      conv.state.toolRouter.registerExpected("call-1", "Read");
      const resultPromise = new Promise<string>((resolve, reject) => {
        conv.state.toolRouter.registerMCPRequest("Read", resolve, reject);
      });

      manager.remove(conv.id);

      await expect(resultPromise).rejects.toThrow("Session cleanup");
    });
  });

  describe("findByContinuationIds", () => {
    it("returns undefined for empty ids", () => {
      expect(createManager().findByContinuationIds([])).toBeUndefined();
    });

    it("matches conversation by pending tool call id", () => {
      const manager = createManager();
      const conv = manager.create();

      conv.state.toolRouter.registerExpected("tc-123", "Read");
      conv.state.toolRouter.registerMCPRequest(
        "Read",
        () => {},
        () => {},
      );

      expect(manager.findByContinuationIds(["tc-123"])).toBe(conv);
    });

    it("matches conversation by expected (not yet pending) tool call id", () => {
      const manager = createManager();
      const conv = manager.create();

      conv.state.toolRouter.registerExpected("tc-456", "Write");

      expect(manager.findByContinuationIds(["tc-456"])).toBe(conv);
    });

    it("matches the correct conversation among multiple", () => {
      const manager = createManager();
      const conv1 = manager.create();
      const conv2 = manager.create();

      conv1.state.toolRouter.registerExpected("tc-aaa", "Read");
      conv2.state.toolRouter.registerExpected("tc-bbb", "Write");

      expect(manager.findByContinuationIds(["tc-bbb"])).toBe(conv2);
    });

    it("falls back to sessionActive when id does not match any pending", () => {
      const manager = createManager();
      const conv = manager.create();
      conv.state.session.markSessionActive();

      expect(manager.findByContinuationIds(["tc-unknown"])).toBe(conv);
    });

    it("returns undefined when id does not match and no session is active", () => {
      const manager = createManager();
      manager.create();

      expect(manager.findByContinuationIds(["tc-unknown"])).toBeUndefined();
    });
  });

  describe("findByExpectedTool", () => {
    it("finds state with expected tool", () => {
      const manager = createManager();
      const conv = manager.create();
      conv.state.toolRouter.registerExpected("tc-1", "Bash");

      expect(manager.findByExpectedTool("Bash")).toBe(conv.state);
    });

    it("returns undefined when no conversation expects the tool", () => {
      const manager = createManager();
      manager.create();
      expect(manager.findByExpectedTool("Bash")).toBeUndefined();
    });
  });

  describe("removing conversations", () => {
    it("keeps an idle conversation until the next request", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      const conv = manager.create();
      conv.state.session.markSessionActive();
      conv.state.session.markSessionInactive();

      // Going idle does not remove it on its own.
      expect(manager.getState(conv.id)).toBe(conv.state);

      // The next request sweeps it.
      manager.findForNewRequest();
      expect(manager.getState(conv.id)).toBeUndefined();
    });

    it("keeps the primary conversation when idle", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;
      primary.state.session.markSessionActive();
      primary.state.session.markSessionInactive();

      manager.findForNewRequest();
      expect(manager.getPrimary()).toBe(primary);
    });

    // An isolated conversation that goes idle right after emitting tool
    // requests must stay alive because the bridge still has tools/call to deliver.
    it("keeps a conversation that asked for a tool", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      const conv = manager.create();
      conv.state.session.markSessionActive();
      conv.state.toolRouter.registerExpected("toolu_01abc", "XcodeRead");
      conv.state.session.markSessionInactive();

      manager.findForNewRequest();
      expect(manager.getState(conv.id)).toBe(conv.state);
    });

    // While a finished conversation is still in the map, nothing should route
    // to it, just as if it had already been removed.
    it("does not route to a finished conversation", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      // An isolated conversation runs a tool call to completion, then goes idle.
      const finished = manager.create();
      finished.state.session.markSessionActive();
      finished.state.toolRouter.registerExpected("toolu_done", "Read");
      finished.state.toolRouter.registerMCPRequest(
        "Read",
        () => {},
        () => {},
      );
      finished.state.toolRouter.resolveToolCall("toolu_done", "result");
      finished.state.session.markSessionInactive();

      // It is still in the map, but nothing can route to it.
      expect(manager.getState(finished.id)).toBe(finished.state);
      expect(manager.findByContinuationIds(["toolu_done"])).toBeUndefined();
      expect(manager.findByExpectedTool("Read")).toBeUndefined();
    });

    it("removes a finished conversation on the next request", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      const finished = manager.create();
      finished.state.session.markSessionActive();
      finished.state.session.markSessionInactive();

      const { conversation, isReuse } = manager.findForNewRequest();

      expect(isReuse).toBe(true);
      expect(conversation).toBe(primary);
      expect(manager.getState(finished.id)).toBeUndefined();
    });
  });

  describe("tool_use continuation after session goes inactive", () => {
    it("findByContinuationIds matches primary via pending tool call after markSessionInactive", () => {
      const manager = createManager();
      const conv = manager.create({ isPrimary: true });
      conv.session = { on: () => () => {} } as never;
      conv.state.session.markSessionActive();
      conv.state.toolRouter.registerExpected("toolu_01abc", "mcp__xcode__Read");
      conv.state.session.markSessionInactive();

      expect(manager.findByContinuationIds(["toolu_01abc"])).toBe(conv);
    });

    it("findByExpectedTool matches primary after markSessionInactive", () => {
      const manager = createManager();
      const conv = manager.create({ isPrimary: true });
      conv.state.session.markSessionActive();
      conv.state.toolRouter.registerExpected("toolu_01abc", "mcp__xcode__Read");
      conv.state.session.markSessionInactive();

      expect(manager.findByExpectedTool("mcp__xcode__Read")).toBe(conv.state);
    });
  });

  describe("subagent isolation", () => {
    it("subagent request does not stomp on primary's pending tool calls", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      primary.state.session.markSessionActive();
      primary.state.toolRouter.registerExpected("toolu_task", "Task");
      primary.state.toolRouter.registerExpected("toolu_fetch", "WebFetch");
      primary.state.session.markSessionInactive();

      primary.state.toolRouter.registerMCPRequest(
        "Task",
        () => {},
        () => {},
      );
      primary.state.toolRouter.registerMCPRequest(
        "WebFetch",
        () => {},
        () => {},
      );

      const { conversation: subagent, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(false);
      expect(subagent).not.toBe(primary);

      expect(primary.state.toolRouter.hasPendingToolCall("toolu_task")).toBe(
        true,
      );
      expect(primary.state.toolRouter.hasPendingToolCall("toolu_fetch")).toBe(
        true,
      );
      expect(manager.findByContinuationIds(["toolu_task"])).toBe(primary);
    });

    it("primary is reusable again after pending tool calls are resolved", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      primary.state.session.markSessionActive();
      primary.state.toolRouter.registerExpected("toolu_1", "Read");
      primary.state.session.markSessionInactive();
      primary.state.toolRouter.registerMCPRequest(
        "Read",
        () => {},
        () => {},
      );

      expect(manager.findForNewRequest().isReuse).toBe(false);

      primary.state.toolRouter.resolveToolCall("toolu_1", "result");

      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(true);
      expect(conversation).toBe(primary);
    });
  });

  describe("primary session", () => {
    it("getPrimary returns undefined when no primary exists", () => {
      expect(createManager().getPrimary()).toBeUndefined();
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
      expect(manager.getPrimary()).toBeUndefined();
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
      expect(manager.getPrimary()).toBeUndefined();
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
      primary.state.session.markSessionActive();

      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(false);
      expect(conversation.isPrimary).toBe(false);
      expect(conversation).not.toBe(primary);
      expect(manager.getPrimary()).toBe(primary);
    });

    it("creates isolated conversation when primary has pending tool calls", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      primary.state.session.markSessionActive();
      primary.state.toolRouter.registerExpected("toolu_01abc", "Task");
      primary.state.toolRouter.registerMCPRequest(
        "Task",
        () => {},
        () => {},
      );
      primary.state.session.markSessionInactive();

      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(false);
      expect(conversation).not.toBe(primary);
      expect(conversation.isPrimary).toBe(false);
    });

    it("creates isolated conversation when primary has expected tool entries", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      primary.state.session.markSessionActive();
      primary.state.toolRouter.registerExpected("toolu_01abc", "Task");
      primary.state.session.markSessionInactive();

      const { conversation, isReuse } = manager.findForNewRequest();
      expect(isReuse).toBe(false);
      expect(conversation).not.toBe(primary);
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

    it("calls cleanup on evicted conversations", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      const isolated = manager.create();
      const cleanup = vi.spyOn(isolated.state.session, "cleanup");

      manager.findForNewRequest();

      expect(cleanup).toHaveBeenCalledOnce();
      expect(manager.getState(isolated.id)).toBeUndefined();
    });

    it("does NOT evict active non-primary conversations", () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;
      primary.state.session.markSessionActive();

      const isolated = manager.create();
      isolated.state.session.markSessionActive();
      expect(manager.size).toBe(2);

      manager.findForNewRequest();
      expect(manager.size).toBe(3);
    });

    // A new request must not evict an isolated conversation that still has a
    // tool call in flight, or the bridge loses it before the result comes back.
    it("does not evict a conversation with a pending tool call", async () => {
      const manager = createManager();
      const primary = manager.create({ isPrimary: true });
      primary.session = { on: () => () => {} } as never;

      const isolated = manager.create();
      isolated.state.toolRouter.registerExpected("call-1", "Read");
      const resultPromise = new Promise<string>((resolve, reject) => {
        isolated.state.toolRouter.registerMCPRequest("Read", resolve, reject);
      });

      manager.findForNewRequest();

      expect(manager.getState(isolated.id)).toBe(isolated.state);
      expect(isolated.state.toolRouter.resolveToolCall("call-1", "ok")).toBe(
        true,
      );
      await expect(resultPromise).resolves.toBe("ok");
    });
  });
});
