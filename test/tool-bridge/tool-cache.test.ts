import { describe, it, expect } from "vitest";
import { ToolCache } from "../../src/tool-bridge/tool-cache.js";

function makeTool(name: string) {
  return { name, description: "", input_schema: { type: "object" as const, properties: {} } };
}

describe("ToolCache", () => {
  describe("cacheTools / getCachedTools", () => {
    it("stores and retrieves tools", () => {
      const cache = new ToolCache();
      const tools = [makeTool("Read")];
      cache.cacheTools(tools);
      expect(cache.getCachedTools()).toBe(tools);
    });

    it("returns empty array by default", () => {
      expect(new ToolCache().getCachedTools()).toEqual([]);
    });
  });

  describe("resolveToolName", () => {
    it("returns exact match unchanged", () => {
      const cache = new ToolCache();
      cache.cacheTools([makeTool("mcp__xcode-tools__XcodeRead")]);
      expect(cache.resolveToolName("mcp__xcode-tools__XcodeRead")).toBe("mcp__xcode-tools__XcodeRead");
    });

    it("resolves a hallucinated short name via suffix match", () => {
      const cache = new ToolCache();
      cache.cacheTools([makeTool("mcp__xcode-tools__XcodeRead")]);
      expect(cache.resolveToolName("XcodeRead")).toBe("mcp__xcode-tools__XcodeRead");
    });

    it("returns name as-is when no cached tools match", () => {
      const cache = new ToolCache();
      cache.cacheTools([makeTool("mcp__xcode-tools__XcodeRead")]);
      expect(cache.resolveToolName("Unknown")).toBe("Unknown");
    });

    it("returns name as-is when suffix is ambiguous", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeTool("mcp__server-a__Read"),
        makeTool("mcp__server-b__Read"),
      ]);
      expect(cache.resolveToolName("Read")).toBe("Read");
    });

    it("returns name as-is with no cached tools", () => {
      expect(new ToolCache().resolveToolName("XcodeRead")).toBe("XcodeRead");
    });

    it("does not match partial suffixes without __ boundary", () => {
      const cache = new ToolCache();
      cache.cacheTools([makeTool("mcp__xcode-tools__SomeXcodeRead")]);
      expect(cache.resolveToolName("XcodeRead")).toBe("XcodeRead");
    });
  });
});
