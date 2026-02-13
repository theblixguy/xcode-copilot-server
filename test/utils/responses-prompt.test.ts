import { describe, it, expect } from "vitest";
import {
  formatResponsesPrompt,
  extractInstructions,
  extractFunctionCallOutputs,
} from "../../src/providers/codex/prompt.js";

describe("formatResponsesPrompt", () => {
  it("handles string input", () => {
    expect(formatResponsesPrompt("Hello", [])).toBe("[User]: Hello");
  });

  it("handles user message in array", () => {
    const input = [{ role: "user" as const, content: "Hello" }];
    expect(formatResponsesPrompt(input, [])).toBe("[User]: Hello");
  });

  it("handles assistant message in array", () => {
    const input = [{ role: "assistant" as const, content: "Hi there" }];
    expect(formatResponsesPrompt(input, [])).toBe("[Assistant]: Hi there");
  });

  it("skips system messages", () => {
    const input = [
      { role: "system" as const, content: "Be helpful" },
      { role: "user" as const, content: "Hello" },
    ];
    expect(formatResponsesPrompt(input, [])).toBe("[User]: Hello");
  });

  it("skips developer messages", () => {
    const input = [
      { role: "developer" as const, content: "Instructions" },
      { role: "user" as const, content: "Hello" },
    ];
    expect(formatResponsesPrompt(input, [])).toBe("[User]: Hello");
  });

  it("handles function_call items", () => {
    const input = [
      { type: "function_call" as const, call_id: "call_1", name: "get_weather", arguments: '{"city":"SF"}' },
    ];
    expect(formatResponsesPrompt(input, [])).toBe(
      '[Assistant called tool get_weather with args: {"city":"SF"}]',
    );
  });

  it("handles function_call_output items", () => {
    const input = [
      { type: "function_call_output" as const, call_id: "call_1", output: "Sunny, 72F" },
    ];
    expect(formatResponsesPrompt(input, [])).toBe(
      "[Tool result for call_1]: Sunny, 72F",
    );
  });

  it("handles mixed items", () => {
    const input = [
      { role: "user" as const, content: "What's the weather?" },
      { type: "function_call" as const, call_id: "call_1", name: "get_weather", arguments: '{"city":"SF"}' },
      { type: "function_call_output" as const, call_id: "call_1", output: "Sunny" },
    ];
    const result = formatResponsesPrompt(input, []);
    expect(result).toContain("[User]: What's the weather?");
    expect(result).toContain("[Assistant called tool get_weather");
    expect(result).toContain("[Tool result for call_1]: Sunny");
  });

  it("applies excluded file patterns to user content", () => {
    const input = "```swift:Generated.swift\nsome code\n```\nreal content";
    expect(formatResponsesPrompt(input, ["Generated"])).toBe(
      "[User]: real content",
    );
  });
});

describe("extractInstructions", () => {
  it("returns undefined for string input", () => {
    expect(extractInstructions("Hello")).toBeUndefined();
  });

  it("returns undefined when no system messages", () => {
    const input = [{ role: "user" as const, content: "Hello" }];
    expect(extractInstructions(input)).toBeUndefined();
  });

  it("extracts system message content", () => {
    const input = [
      { role: "system" as const, content: "Be helpful" },
      { role: "user" as const, content: "Hello" },
    ];
    expect(extractInstructions(input)).toBe("Be helpful");
  });

  it("extracts developer message content", () => {
    const input = [
      { role: "developer" as const, content: "Instructions" },
    ];
    expect(extractInstructions(input)).toBe("Instructions");
  });

  it("joins multiple system/developer messages", () => {
    const input = [
      { role: "system" as const, content: "Part 1" },
      { role: "developer" as const, content: "Part 2" },
    ];
    expect(extractInstructions(input)).toBe("Part 1\n\nPart 2");
  });
});

describe("extractFunctionCallOutputs", () => {
  it("returns empty for string input", () => {
    expect(extractFunctionCallOutputs("Hello")).toEqual([]);
  });

  it("returns empty when no function_call_output items", () => {
    const input = [{ role: "user" as const, content: "Hello" }];
    expect(extractFunctionCallOutputs(input)).toEqual([]);
  });

  it("extracts function_call_output items", () => {
    const input = [
      { role: "user" as const, content: "Hello" },
      { type: "function_call_output" as const, call_id: "call_1", output: "result1" },
      { type: "function_call_output" as const, call_id: "call_2", output: "result2" },
    ];
    const outputs = extractFunctionCallOutputs(input);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]!.call_id).toBe("call_1");
    expect(outputs[1]!.call_id).toBe("call_2");
  });
});
