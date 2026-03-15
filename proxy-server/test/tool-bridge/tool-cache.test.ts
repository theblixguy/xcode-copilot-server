import { describe, it, expect } from "vitest";
import { ToolCache } from "../../src/tool-bridge/tool-cache.js";

function makeTool(name: string) {
  return {
    name,
    description: "",
    input_schema: { type: "object" as const, properties: {} },
  };
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
      expect(cache.resolveToolName("mcp__xcode-tools__XcodeRead")).toBe(
        "mcp__xcode-tools__XcodeRead",
      );
    });

    it("resolves a hallucinated short name via suffix match", () => {
      const cache = new ToolCache();
      cache.cacheTools([makeTool("mcp__xcode-tools__XcodeRead")]);
      expect(cache.resolveToolName("XcodeRead")).toBe(
        "mcp__xcode-tools__XcodeRead",
      );
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

  describe("normalizeArgs", () => {
    function makeToolWithSchema(
      name: string,
      properties: Record<string, unknown>,
    ) {
      return {
        name,
        description: "",
        input_schema: { type: "object" as const, properties },
      };
    }

    it("returns args unchanged when all keys match the schema", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("Grep", {
          pattern: { type: "string" },
          "-i": { type: "boolean" },
        }),
      ]);
      const args = { pattern: "foo", "-i": true };
      expect(cache.normalizeArgs("Grep", args)).toEqual(args);
    });

    it("converts camelCase keys to snake_case", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("Grep", {
          output_mode: { type: "string" },
          head_limit: { type: "number" },
        }),
      ]);
      expect(
        cache.normalizeArgs("Grep", { outputMode: "content", headLimit: 10 }),
      ).toEqual({ output_mode: "content", head_limit: 10 });
    });

    it("converts snake_case keys to camelCase", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("XcodeRead", {
          filePath: { type: "string" },
        }),
      ]);
      expect(
        cache.normalizeArgs("XcodeRead", { file_path: "/foo.swift" }),
      ).toEqual({ filePath: "/foo.swift" });
    });

    it("resolves CLI flag aliases", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("Grep", {
          "-i": { type: "boolean" },
          "-n": { type: "boolean" },
          "-A": { type: "number" },
          "-B": { type: "number" },
        }),
      ]);
      expect(
        cache.normalizeArgs("Grep", {
          ignoreCase: true,
          lineNumbers: true,
          afterContext: 3,
          beforeContext: 2,
        }),
      ).toEqual({ "-i": true, "-n": true, "-A": 3, "-B": 2 });
    });

    it("normalizes camelCase enum values to snake_case", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("Grep", {
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
          },
        }),
      ]);
      expect(
        cache.normalizeArgs("Grep", { outputMode: "filesWithMatches" }),
      ).toEqual({ output_mode: "files_with_matches" });
    });

    it("leaves enum values alone when they already match", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("Grep", {
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
          },
        }),
      ]);
      expect(cache.normalizeArgs("Grep", { output_mode: "content" })).toEqual({
        output_mode: "content",
      });
    });

    it("passes through unknown keys unchanged", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("Grep", {
          pattern: { type: "string" },
        }),
      ]);
      expect(
        cache.normalizeArgs("Grep", { pattern: "foo", weird: 42 }),
      ).toEqual({ pattern: "foo", weird: 42 });
    });

    it("returns args unchanged when tool has no schema properties", () => {
      const cache = new ToolCache();
      cache.cacheTools([makeTool("Read")]);
      const args = { file_path: "/test.txt" };
      expect(cache.normalizeArgs("Read", args)).toEqual(args);
    });

    it("returns args unchanged when tool is not found", () => {
      const cache = new ToolCache();
      const args = { foo: "bar" };
      expect(cache.normalizeArgs("Unknown", args)).toEqual(args);
    });

    it("handles mixed correct and incorrect keys together", () => {
      const cache = new ToolCache();
      cache.cacheTools([
        makeToolWithSchema("Grep", {
          pattern: { type: "string" },
          "-i": { type: "boolean" },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
          },
          glob: { type: "string" },
        }),
      ]);
      expect(
        cache.normalizeArgs("Grep", {
          pattern: "test",
          ignoreCase: true,
          outputMode: "filesWithMatches",
          glob: "*.ts",
        }),
      ).toEqual({
        pattern: "test",
        "-i": true,
        output_mode: "files_with_matches",
        glob: "*.ts",
      });
    });
  });
});
