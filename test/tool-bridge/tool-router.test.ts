import { describe, it, expect, vi } from "vitest";
import { ToolRouter } from "../../src/tool-bridge/tool-router.js";

describe("ToolRouter", () => {
  describe("hasPendingToolCall", () => {
    it("returns false for empty state", () => {
      expect(new ToolRouter().hasPendingToolCall("any")).toBe(false);
    });

    it("returns true when tool call is in pendingByCallId", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Read");
      router.registerMCPRequest("Read", () => {}, () => {});
      expect(router.hasPendingToolCall("tc-1")).toBe(true);
    });

    it("returns true when tool call is in expectedByName queue", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-2", "Write");
      expect(router.hasPendingToolCall("tc-2")).toBe(true);
    });

    it("returns false for a different tool call id", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-3", "Read");
      expect(router.hasPendingToolCall("tc-other")).toBe(false);
    });
  });

  describe("hasExpectedTool", () => {
    it("returns false for empty state", () => {
      expect(new ToolRouter().hasExpectedTool("Read")).toBe(false);
    });

    it("returns true after registerExpected", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Bash");
      expect(router.hasExpectedTool("Bash")).toBe(true);
    });

    it("returns false after queue is fully drained", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Glob");
      router.registerMCPRequest("Glob", () => {}, () => {});
      expect(router.hasExpectedTool("Glob")).toBe(false);
    });

    it("returns false for a different tool name", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Read");
      expect(router.hasExpectedTool("Write")).toBe(false);
    });
  });

  describe("registerExpected / registerMCPRequest FIFO ordering", () => {
    it("matches MCP requests in FIFO order", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-first", "Read");
      router.registerExpected("tc-second", "Read");

      router.registerMCPRequest("Read", () => {}, () => {});
      expect(router.hasPendingToolCall("tc-first")).toBe(true);
      expect(router.hasPendingToolCall("tc-second")).toBe(true);

      router.registerMCPRequest("Read", () => {}, () => {});
      expect(router.hasPendingToolCall("tc-second")).toBe(true);
      expect(router.hasExpectedTool("Read")).toBe(false);
    });
  });

  describe("registerMCPRequest with no expected entry", () => {
    it("rejects immediately when no tool is expected", () => {
      const router = new ToolRouter();
      const reject = vi.fn();
      router.registerMCPRequest("Unknown", () => {}, reject);
      expect(reject).toHaveBeenCalledOnce();
      expect(reject.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect((reject.mock.calls[0]?.[0] as Error).message).toContain("Unknown");
    });
  });

  describe("resolveToolCall", () => {
    it("resolves a pending tool call and returns true", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Read");
      const resolve = vi.fn();
      router.registerMCPRequest("Read", resolve, () => {});

      const found = router.resolveToolCall("tc-1", "file contents");
      expect(found).toBe(true);
      expect(resolve).toHaveBeenCalledWith("file contents");
    });

    it("returns false for unknown tool call id", () => {
      expect(new ToolRouter().resolveToolCall("nope", "x")).toBe(false);
    });

    it("cleans up stale expected entries not yet promoted to pending", () => {
      const router = new ToolRouter();
      // Simulate: model calls tool with hallucinated name, CLI fails it without
      // calling our MCP endpoint. The expected entry becomes stale.
      router.registerExpected("stale-tc", "Read");
      expect(router.hasExpectedTool("Read")).toBe(true);

      // resolveToolCall should find and remove the stale expected entry
      const found = router.resolveToolCall("stale-tc", "error result");
      expect(found).toBe(true);
      expect(router.hasExpectedTool("Read")).toBe(false);
      expect(router.hasPending).toBe(false);
    });

    it("stale cleanup does not affect other entries for the same tool", () => {
      const router = new ToolRouter();
      router.registerExpected("stale-tc", "Read");
      router.registerExpected("good-tc", "Read");

      // Clean up only the stale one
      router.resolveToolCall("stale-tc", "error");

      // The good entry should still be there
      expect(router.hasExpectedTool("Read")).toBe(true);
      expect(router.hasPendingToolCall("good-tc")).toBe(true);
    });

    it("stale cleanup prevents wrong toolCallId binding on next registerMCPRequest", () => {
      const router = new ToolRouter();
      // Step 1: register expected with a stale toolCallId
      router.registerExpected("stale-tc", "Read");

      // Step 2: simulate CLI failing the tool without calling MCP
      router.resolveToolCall("stale-tc", "Tool does not exist");

      // Step 3: model retries with correct name, register new expected
      router.registerExpected("good-tc", "Read");

      // Step 4: MCP endpoint receives request, should bind to good-tc
      const resolve = vi.fn();
      router.registerMCPRequest("Read", resolve, () => {});

      // Step 5: resolve with good-tc should work
      const found = router.resolveToolCall("good-tc", "file contents");
      expect(found).toBe(true);
      expect(resolve).toHaveBeenCalledWith("file contents");
    });

    it("removes the tool call from pending after resolution", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Read");
      router.registerMCPRequest("Read", () => {}, () => {});
      router.resolveToolCall("tc-1", "ok");
      expect(router.hasPendingToolCall("tc-1")).toBe(false);
      expect(router.hasPending).toBe(false);
    });
  });

  describe("hasPending getter", () => {
    it("returns false for empty state", () => {
      expect(new ToolRouter().hasPending).toBe(false);
    });

    it("returns true with expected tools only", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Read");
      expect(router.hasPending).toBe(true);
    });

    it("returns true with pending MCP requests only", () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Read");
      router.registerMCPRequest("Read", () => {}, () => {});
      expect(router.hasPending).toBe(true);
    });
  });

  describe("rejectAll", () => {
    it("clears expected and rejects pending with given reason", async () => {
      const router = new ToolRouter();
      router.registerExpected("tc-1", "Read");
      router.registerExpected("tc-2", "Write");
      const promise = new Promise<string>((resolve, reject) => {
        router.registerMCPRequest("Read", resolve, reject);
      });

      router.rejectAll("test reason");

      await expect(promise).rejects.toThrow("test reason");
      expect(router.hasPending).toBe(false);
      expect(router.hasExpectedTool("Write")).toBe(false);
    });

    it("is safe to call on empty state", () => {
      const router = new ToolRouter();
      expect(() => { router.rejectAll("noop"); }).not.toThrow();
    });
  });
});
