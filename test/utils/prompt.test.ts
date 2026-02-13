import { describe, it, expect } from "vitest";
import { extractContentText, type ChatCompletionMessage } from "../../src/providers/openai/schemas.js";
import { formatPrompt, filterExcludedFiles } from "../../src/providers/openai/prompt.js";

describe("extractContentText", () => {
  it("returns string content as-is", () => {
    expect(extractContentText("Hello, world!")).toBe("Hello, world!");
  });

  it("returns empty string for null", () => {
    expect(extractContentText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractContentText(undefined)).toBe("");
  });

  it("handles array with single text part", () => {
    const content = [{ type: "text", text: "Hello" }];
    expect(extractContentText(content)).toBe("Hello");
  });

  it("concatenates array with multiple text parts", () => {
    const content = [
      { type: "text", text: "Hello" },
      { type: "text", text: " World" },
    ];
    expect(extractContentText(content)).toBe("Hello World");
  });

  it("throws on unsupported content type (image_url)", () => {
    const content = [
      {
        type: "image_url",
        image_url: { url: "http://example.com/img.png" },
      },
    ];
    expect(() => extractContentText(content)).toThrow("unsupported content type: image_url");
  });

  it("throws on non-object array element", () => {
    const content = ["not an object"] as unknown as Array<{ type: string }>;
    expect(() => extractContentText(content)).toThrow("unsupported content type");
  });

  it("throws on missing type field", () => {
    const content = [{ text: "Hello" }] as unknown as Array<{ type: string }>;
    expect(() => extractContentText(content)).toThrow(
      "unsupported content type",
    );
  });

  it("throws on missing text field", () => {
    const content = [{ type: "text" }];
    expect(() => extractContentText(content)).toThrow(
      "text content part missing required 'text' field",
    );
  });

  it("throws on invalid content type - number", () => {
    expect(() => extractContentText(42 as unknown as string)).toThrow(
      "invalid content type: expected string or array",
    );
  });

  it("throws on invalid content type - boolean", () => {
    expect(() => extractContentText(true as unknown as string)).toThrow(
      "invalid content type: expected string or array",
    );
  });
});

describe("formatPrompt", () => {
  it("basic user assistant interaction", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = formatPrompt(messages, []);
    expect(result).toContain("[User]: Hello");
    expect(result).toContain("[Assistant]: Hi there");
  });

  it("system message should be ignored in prompt", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
    ];
    const result = formatPrompt(messages, []);
    expect(result).toContain("[User]: Hello");
    expect(result).not.toContain("[System]: You are a helpful assistant");
    expect(result).not.toContain("You are a helpful assistant");
  });

  it("multiple system messages should be ignored", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "Sys 1" },
      { role: "user", content: "User 1" },
      { role: "system", content: "Sys 2" },
    ];
    const result = formatPrompt(messages, []);
    expect(result).toContain("[User]: User 1");
    expect(result).not.toContain("Sys 1");
    expect(result).not.toContain("Sys 2");
  });

  it("developer role messages are skipped like system", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "developer", content: "Custom instructions" },
      { role: "user", content: "Hello" },
    ];
    const result = formatPrompt(messages, []);
    expect(result).toContain("[User]: Hello");
    expect(result).not.toContain("Custom instructions");
  });

  it("tool role messages include tool_call_id", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "tool", content: "result data", tool_call_id: "call_abc123" },
    ];
    const result = formatPrompt(messages, []);
    expect(result).toBe("[Tool result for call_abc123]: result data");
  });

  it("assistant with tool_calls renders call details", () => {
    const messages: ChatCompletionMessage[] = [
      {
        role: "assistant",
        content: "Let me search",
        tool_calls: [
          {
            function: { name: "search", arguments: '{"q":"test"}' },
          },
        ],
      },
    ];
    const result = formatPrompt(messages, []);
    expect(result).toContain("[Assistant]: Let me search");
    expect(result).toContain('[Assistant called tool search with args: {"q":"test"}]');
  });

  it("assistant with no content but tool_calls only renders calls", () => {
    const messages: ChatCompletionMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
        ],
      },
    ];
    const result = formatPrompt(messages, []);
    expect(result).not.toContain("[Assistant]: ");
    expect(result).toContain("[Assistant called tool read_file");
  });

  it("multi-turn conversation with tools", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "user", content: "Find bugs" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "search", arguments: '{"q":"bug"}' } },
        ],
      },
      { role: "tool", content: "Found 3 bugs", tool_call_id: "call_1" },
      { role: "assistant", content: "I found 3 bugs in your code." },
    ];
    const result = formatPrompt(messages, []);
    expect(result).toContain("[User]: Find bugs");
    expect(result).toContain("[Assistant called tool search");
    expect(result).toContain("[Tool result for call_1]: Found 3 bugs");
    expect(result).toContain("[Assistant]: I found 3 bugs in your code.");
  });

  it("slice(0) on first turn produces full prompt", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "user", content: "What is 2+2?" },
    ];
    const full = formatPrompt(messages, []);
    const sliced = formatPrompt(messages.slice(0), []);
    expect(sliced).toBe(full);
  });

  it("slice(sentMessageCount) on second turn produces only new messages", () => {
    const turn1: ChatCompletionMessage[] = [
      { role: "user", content: "What is 2+2?" },
    ];
    const turn2: ChatCompletionMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "What about 3+3?" },
    ];

    const sentMessageCount = turn1.length;
    const result = formatPrompt(turn2.slice(sentMessageCount), []);

    expect(result).not.toContain("What is 2+2?");
    expect(result).toContain("[Assistant]: 4");
    expect(result).toContain("[User]: What about 3+3?");
  });

  it("slice produces only the latest turn in a 3-turn conversation", () => {
    const allMessages: ChatCompletionMessage[] = [
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "user", content: "Turn 2" },
      { role: "assistant", content: "Reply 2" },
      { role: "user", content: "Turn 3" },
    ];

    const sentMessageCount = 3;
    const result = formatPrompt(allMessages.slice(sentMessageCount), []);

    expect(result).not.toContain("Turn 1");
    expect(result).not.toContain("Reply 1");
    expect(result).not.toContain("Turn 2");
    expect(result).toContain("[Assistant]: Reply 2");
    expect(result).toContain("[User]: Turn 3");
  });

  it("slice after tool cycle skips already-sent tool messages", () => {
    const allMessages: ChatCompletionMessage[] = [
      { role: "user", content: "Find bugs" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "search", arguments: '{"q":"bug"}' } },
        ],
      },
      { role: "tool", content: "Found 3 bugs", tool_call_id: "call_1" },
      { role: "assistant", content: "I found 3 bugs." },
      { role: "user", content: "Fix them" },
    ];

    const sentMessageCount = 3;
    const result = formatPrompt(allMessages.slice(sentMessageCount), []);

    expect(result).not.toContain("Find bugs");
    expect(result).not.toContain("search");
    expect(result).not.toContain("call_1");
    expect(result).toContain("[Assistant]: I found 3 bugs.");
    expect(result).toContain("[User]: Fix them");
  });

  it("slice(0) on error recovery resends full history", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "What about 3+3?" },
    ];

    const result = formatPrompt(messages.slice(0), []);

    expect(result).toContain("[User]: What is 2+2?");
    expect(result).toContain("[Assistant]: 4");
    expect(result).toContain("[User]: What about 3+3?");
  });

  it("slice skips system/developer messages that were already sent", () => {
    const allMessages: ChatCompletionMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "user", content: "Turn 2" },
    ];

    const sentMessageCount = 2;
    const result = formatPrompt(allMessages.slice(sentMessageCount), []);

    expect(result).not.toContain("You are helpful");
    expect(result).not.toContain("Turn 1");
    expect(result).toContain("[Assistant]: Reply 1");
    expect(result).toContain("[User]: Turn 2");
  });
});

describe("filterExcludedFiles", () => {
  const fence = "```";
  const mockPatterns = ["mock"];

  it("no mock files - real file untouched", () => {
    const input = `${fence}swift:RealFile.swift\nfunc hello() {}\n${fence}\n`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe(input);
  });

  it("single mock file removed", () => {
    const input = `Results:\n${fence}swift:Mock.SwiftyMocky\nclass Mock {}\n${fence}\nDone`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe("Results:\nDone");
  });

  it("mock file removed, real files kept", () => {
    const input =
      `${fence}swift:Real.swift\nlet x = 1\n${fence}\n` +
      `${fence}swift:MockHelper.swift\nclass MockHelper {}\n${fence}\n` +
      `${fence}swift:Other.swift\nlet y = 2\n${fence}\n`;
    const want =
      `${fence}swift:Real.swift\nlet x = 1\n${fence}\n` +
      `${fence}swift:Other.swift\nlet y = 2\n${fence}\n`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe(want);
  });

  it("case insensitive - lowercase mock", () => {
    const input = `${fence}swift:mock_helpers.swift\nstuff\n${fence}\n`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe("");
  });

  it("no code blocks at all", () => {
    expect(filterExcludedFiles("just plain text", mockPatterns)).toBe("just plain text");
  });

  it("empty string", () => {
    expect(filterExcludedFiles("", mockPatterns)).toBe("");
  });

  it("empty patterns - nothing filtered", () => {
    const input = `${fence}swift:MockFile.swift\nstuff\n${fence}\n`;
    expect(filterExcludedFiles(input, [])).toBe(input);
  });

  it("multiple patterns", () => {
    const input =
      `${fence}swift:Real.swift\nlet x = 1\n${fence}\n` +
      `${fence}swift:MockHelper.swift\nclass MockHelper {}\n${fence}\n` +
      `${fence}swift:TestFixture.swift\nclass Fixture {}\n${fence}\n`;
    const want = `${fence}swift:Real.swift\nlet x = 1\n${fence}\n`;
    expect(filterExcludedFiles(input, ["mock", "fixture"])).toBe(want);
  });
});
