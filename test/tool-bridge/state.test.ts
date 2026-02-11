import { describe, it, expect, vi } from "vitest";
import { ToolBridgeState } from "../../src/tool-bridge/state.js";

describe("ToolBridgeState", () => {
  describe("hasPendingToolCall", () => {
    it("returns false for empty state", () => {
      expect(new ToolBridgeState().hasPendingToolCall("any")).toBe(false);
    });

    it("returns true when tool call is in pendingByCallId", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      state.registerMCPRequest("Read", () => {}, () => {});
      expect(state.hasPendingToolCall("tc-1")).toBe(true);
    });

    it("returns true when tool call is in expectedByName queue", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-2", "Write");
      expect(state.hasPendingToolCall("tc-2")).toBe(true);
    });

    it("returns false for a different tool call id", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-3", "Read");
      expect(state.hasPendingToolCall("tc-other")).toBe(false);
    });
  });

  describe("hasExpectedTool", () => {
    it("returns false for empty state", () => {
      expect(new ToolBridgeState().hasExpectedTool("Read")).toBe(false);
    });

    it("returns true after registerExpected", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Bash");
      expect(state.hasExpectedTool("Bash")).toBe(true);
    });

    it("returns false after queue is fully drained", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Glob");
      state.registerMCPRequest("Glob", () => {}, () => {});
      expect(state.hasExpectedTool("Glob")).toBe(false);
    });

    it("returns false for a different tool name", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      expect(state.hasExpectedTool("Write")).toBe(false);
    });
  });

  describe("registerExpected / registerMCPRequest FIFO ordering", () => {
    it("matches MCP requests in FIFO order", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-first", "Read");
      state.registerExpected("tc-second", "Read");

      state.registerMCPRequest("Read", () => {}, () => {});
      expect(state.hasPendingToolCall("tc-first")).toBe(true);
      expect(state.hasPendingToolCall("tc-second")).toBe(true);

      state.registerMCPRequest("Read", () => {}, () => {});
      expect(state.hasPendingToolCall("tc-second")).toBe(true);
      expect(state.hasExpectedTool("Read")).toBe(false);
    });
  });

  describe("registerMCPRequest with no expected entry", () => {
    it("rejects immediately when no tool is expected", () => {
      const state = new ToolBridgeState();
      const reject = vi.fn();
      state.registerMCPRequest("Unknown", () => {}, reject);
      expect(reject).toHaveBeenCalledOnce();
      expect(reject.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect((reject.mock.calls[0]?.[0] as Error).message).toContain("Unknown");
    });
  });

  describe("resolveToolCall", () => {
    it("resolves a pending tool call and returns true", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      const resolve = vi.fn();
      state.registerMCPRequest("Read", resolve, () => {});

      const found = state.resolveToolCall("tc-1", "file contents");
      expect(found).toBe(true);
      expect(resolve).toHaveBeenCalledWith("file contents");
    });

    it("returns false for unknown tool call id", () => {
      expect(new ToolBridgeState().resolveToolCall("nope", "x")).toBe(false);
    });

    it("removes the tool call from pending after resolution", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      state.registerMCPRequest("Read", () => {}, () => {});
      state.resolveToolCall("tc-1", "ok");
      expect(state.hasPendingToolCall("tc-1")).toBe(false);
      expect(state.hasPending).toBe(false);
    });
  });

  describe("hasPending getter", () => {
    it("returns false for empty state", () => {
      expect(new ToolBridgeState().hasPending).toBe(false);
    });

    it("returns true with expected tools only", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      expect(state.hasPending).toBe(true);
    });

    it("returns true with pending MCP requests only", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      state.registerMCPRequest("Read", () => {}, () => {});
      expect(state.hasPending).toBe(true);
    });
  });

  describe("session lifecycle", () => {
    it("tracks active state via markSessionActive / markSessionInactive", () => {
      const state = new ToolBridgeState();
      expect(state.sessionActive).toBe(false);
      state.markSessionActive();
      expect(state.sessionActive).toBe(true);
      state.markSessionInactive();
      expect(state.sessionActive).toBe(false);
    });

    it("markSessionInactive rejects all pending tool calls", async () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      const promise = new Promise<string>((resolve, reject) => {
        state.registerMCPRequest("Read", resolve, reject);
      });

      state.markSessionActive();
      state.markSessionInactive();

      await expect(promise).rejects.toThrow("Session ended");
    });

    it("markSessionInactive clears expected queue", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      state.registerExpected("tc-2", "Write");
      state.markSessionInactive();
      expect(state.hasExpectedTool("Read")).toBe(false);
      expect(state.hasExpectedTool("Write")).toBe(false);
      expect(state.hasPending).toBe(false);
    });
  });

  describe("onSessionEnd callback", () => {
    it("fires when markSessionInactive is called", () => {
      const state = new ToolBridgeState();
      const callback = vi.fn();
      state.onSessionEnd(callback);
      state.markSessionInactive();
      expect(callback).toHaveBeenCalledOnce();
    });

    it("fires when cleanup is called", () => {
      const state = new ToolBridgeState();
      const callback = vi.fn();
      state.onSessionEnd(callback);
      state.cleanup();
      expect(callback).toHaveBeenCalledOnce();
    });

    it("is cleared after firing (not called twice)", () => {
      const state = new ToolBridgeState();
      const callback = vi.fn();
      state.onSessionEnd(callback);
      state.markSessionInactive();
      state.markSessionInactive(); // second call
      expect(callback).toHaveBeenCalledOnce();
    });
  });

  describe("cleanup", () => {
    it("rejects all pending with 'Session cleanup' error", async () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      const promise = new Promise<string>((resolve, reject) => {
        state.registerMCPRequest("Read", resolve, reject);
      });

      state.cleanup();
      await expect(promise).rejects.toThrow("Session cleanup");
    });

    it("clears all state", () => {
      const state = new ToolBridgeState();
      state.registerExpected("tc-1", "Read");
      state.registerExpected("tc-2", "Write");
      state.markSessionActive();

      state.cleanup();
      expect(state.sessionActive).toBe(false);
      expect(state.hasPending).toBe(false);
      expect(state.hasExpectedTool("Read")).toBe(false);
    });
  });

  describe("tool caching", () => {
    it("stores and retrieves tools", () => {
      const state = new ToolBridgeState();
      const tools = [
        { name: "Read", description: "Read a file", input_schema: { type: "object" as const, properties: {} } },
      ];
      state.cacheTools(tools);
      expect(state.getCachedTools()).toBe(tools);
    });

    it("returns empty array by default", () => {
      expect(new ToolBridgeState().getCachedTools()).toEqual([]);
    });
  });

  describe("resolveToolName", () => {
    function makeTool(name: string) {
      return { name, description: "", input_schema: { type: "object" as const, properties: {} } };
    }

    it("returns exact match unchanged", () => {
      const state = new ToolBridgeState();
      state.cacheTools([makeTool("mcp__xcode-tools__XcodeRead")]);
      expect(state.resolveToolName("mcp__xcode-tools__XcodeRead")).toBe("mcp__xcode-tools__XcodeRead");
    });

    it("resolves a hallucinated short name via suffix match", () => {
      const state = new ToolBridgeState();
      state.cacheTools([makeTool("mcp__xcode-tools__XcodeRead")]);
      expect(state.resolveToolName("XcodeRead")).toBe("mcp__xcode-tools__XcodeRead");
    });

    it("returns name as-is when no cached tools match", () => {
      const state = new ToolBridgeState();
      state.cacheTools([makeTool("mcp__xcode-tools__XcodeRead")]);
      expect(state.resolveToolName("Unknown")).toBe("Unknown");
    });

    it("returns name as-is when suffix is ambiguous", () => {
      const state = new ToolBridgeState();
      state.cacheTools([
        makeTool("mcp__server-a__Read"),
        makeTool("mcp__server-b__Read"),
      ]);
      expect(state.resolveToolName("Read")).toBe("Read");
    });

    it("returns name as-is with no cached tools", () => {
      expect(new ToolBridgeState().resolveToolName("XcodeRead")).toBe("XcodeRead");
    });

    it("does not match partial suffixes without __ boundary", () => {
      const state = new ToolBridgeState();
      state.cacheTools([makeTool("mcp__xcode-tools__SomeXcodeRead")]);
      expect(state.resolveToolName("XcodeRead")).toBe("XcodeRead");
    });
  });

  describe("streaming lifecycle", () => {
    it("waitForStreamingDone resolves when notifyStreamingDone is called", async () => {
      const state = new ToolBridgeState();
      const promise = state.waitForStreamingDone();
      state.notifyStreamingDone();
      await expect(promise).resolves.toBeUndefined();
    });
  });
});
