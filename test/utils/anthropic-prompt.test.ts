import { describe, it, expect } from "vitest";
import { formatAnthropicPrompt } from "../../src/providers/claude/prompt.js";
import type { AnthropicMessage } from "../../src/providers/claude/schemas.js";

describe("formatAnthropicPrompt", () => {
  it("basic user/assistant text (string shorthand)", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toContain("[User]: Hello");
    expect(result).toContain("[Assistant]: Hi there");
  });

  it("array content with text blocks", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Question" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Answer" }],
      },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toContain("[User]: Question");
    expect(result).toContain("[Assistant]: Answer");
  });

  it("tool_use blocks from assistant", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_01",
            name: "search",
            input: { q: "test" },
          },
        ],
      },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toContain(
      '[Assistant called tool search with args: {"q":"test"}]',
    );
  });

  it("tool_result blocks from user", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01",
            content: "Found 3 results",
          },
        ],
      },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toBe("[Tool result for toolu_01]: Found 3 results");
  });

  it("tool_result with TextBlock array content", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_02",
            content: [{ type: "text", text: "Result text" }],
          },
        ],
      },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toBe("[Tool result for toolu_02]: Result text");
  });

  it("tool_result with no content", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_03",
          },
        ],
      },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toBe("[Tool result for toolu_03]: ");
  });

  it("multi-turn conversation with tools", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "Find bugs" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_01",
            name: "search",
            input: { q: "bug" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01",
            content: "Found 3 bugs",
          },
        ],
      },
      { role: "assistant", content: "I found 3 bugs in your code." },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toContain("[User]: Find bugs");
    expect(result).toContain("[Assistant called tool search");
    expect(result).toContain("[Tool result for toolu_01]: Found 3 bugs");
    expect(result).toContain("[Assistant]: I found 3 bugs in your code.");
  });

  it("empty text blocks are skipped", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Real content" },
        ],
      },
    ];
    const result = formatAnthropicPrompt(messages, []);
    expect(result).toBe("[Assistant]: Real content");
  });

  it("slice(0) on first turn produces full prompt", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "What is 2+2?" },
    ];
    const full = formatAnthropicPrompt(messages, []);
    const sliced = formatAnthropicPrompt(messages.slice(0), []);
    expect(sliced).toBe(full);
  });

  it("slice(sentMessageCount) on second turn produces only new messages", () => {
    const turn1: AnthropicMessage[] = [
      { role: "user", content: "What is 2+2?" },
    ];
    const turn2: AnthropicMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "What about 3+3?" },
    ];

    const sentMessageCount = turn1.length;
    const result = formatAnthropicPrompt(turn2.slice(sentMessageCount), []);

    expect(result).not.toContain("What is 2+2?");
    expect(result).toContain("[Assistant]: 4");
    expect(result).toContain("[User]: What about 3+3?");
  });

  it("slice produces only the latest turn in a 3-turn conversation", () => {
    const allMessages: AnthropicMessage[] = [
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "user", content: "Turn 2" },
      { role: "assistant", content: "Reply 2" },
      { role: "user", content: "Turn 3" },
    ];

    const sentMessageCount = 3;
    const result = formatAnthropicPrompt(allMessages.slice(sentMessageCount), []);

    expect(result).not.toContain("Turn 1");
    expect(result).not.toContain("Reply 1");
    expect(result).not.toContain("Turn 2");
    expect(result).toContain("[Assistant]: Reply 2");
    expect(result).toContain("[User]: Turn 3");
  });

  it("slice after tool cycle skips already-sent tool messages", () => {
    const allMessages: AnthropicMessage[] = [
      { role: "user", content: "Find bugs" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_01", name: "search", input: { q: "bug" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_01", content: "Found 3 bugs" },
        ],
      },
      { role: "assistant", content: "I found 3 bugs." },
      { role: "user", content: "Fix them" },
    ];

    const sentMessageCount = 3;
    const result = formatAnthropicPrompt(allMessages.slice(sentMessageCount), []);

    expect(result).not.toContain("Find bugs");
    expect(result).not.toContain("search");
    expect(result).not.toContain("toolu_01");
    expect(result).toContain("[Assistant]: I found 3 bugs.");
    expect(result).toContain("[User]: Fix them");
  });

  it("slice(0) on error recovery resends full history", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "What about 3+3?" },
    ];

    const result = formatAnthropicPrompt(messages.slice(0), []);

    expect(result).toContain("[User]: What is 2+2?");
    expect(result).toContain("[Assistant]: 4");
    expect(result).toContain("[User]: What about 3+3?");
  });

  it("excluded file patterns are applied to user text", () => {
    const fence = "```";
    const userText = `Here are the results:\n${fence}swift:MockHelper.swift\nclass MockHelper {}\n${fence}\n${fence}swift:Real.swift\nlet x = 1\n${fence}\n`;
    const messages: AnthropicMessage[] = [
      { role: "user", content: userText },
    ];
    const result = formatAnthropicPrompt(messages, ["mock"]);
    expect(result).not.toContain("MockHelper");
    expect(result).toContain("Real.swift");
  });
});
