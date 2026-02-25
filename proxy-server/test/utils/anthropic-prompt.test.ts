import { describe, it, expect } from "vitest";
import { formatAnthropicPrompt, type AnthropicMessage } from "copilot-sdk-proxy";
import { filterExcludedFiles } from "../../src/providers/shared/prompt-utils.js";

describe("filterExcludedFiles (Anthropic)", () => {
  it("filters excluded file patterns from user content", () => {
    const fence = "```";
    const userText = `Here are the results:\n${fence}swift:MockHelper.swift\nclass MockHelper {}\n${fence}\n${fence}swift:Real.swift\nlet x = 1\n${fence}\n`;
    const messages: AnthropicMessage[] = [
      { role: "user", content: userText },
    ];
    const result = filterExcludedFiles(formatAnthropicPrompt(messages), ["mock"]);
    expect(result).not.toContain("MockHelper");
    expect(result).toContain("Real.swift");
  });
});
