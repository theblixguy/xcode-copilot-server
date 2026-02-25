import { describe, it, expect } from "vitest";
import { formatResponsesPrompt } from "copilot-sdk-proxy";
import { filterExcludedFiles } from "../../src/providers/shared/prompt-utils.js";

describe("filterExcludedFiles (Responses)", () => {
  it("applies excluded file patterns to user content", () => {
    const input = "```swift:Generated.swift\nsome code\n```\nreal content";
    expect(filterExcludedFiles(formatResponsesPrompt(input), ["Generated"])).toBe(
      "[User]: real content",
    );
  });
});
