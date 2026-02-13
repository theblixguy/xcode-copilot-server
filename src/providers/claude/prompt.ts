import type { AnthropicMessage, ContentBlock } from "./schemas.js";
import { filterExcludedFiles } from "../shared/prompt-utils.js";

function extractToolResultText(
  content: string | { type: "text"; text: string }[] | undefined,
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.map((b) => b.text).join("");
}

function formatBlocks(
  blocks: ContentBlock[],
  role: "user" | "assistant",
  excludedFilePatterns: string[],
  parts: string[],
): void {
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (!block.text) break;
        if (role === "user") {
          parts.push(
            `[User]: ${filterExcludedFiles(block.text, excludedFilePatterns)}`,
          );
        } else {
          parts.push(`[Assistant]: ${block.text}`);
        }
        break;

      case "tool_use":
        parts.push(
          `[Assistant called tool ${block.name} with args: ${JSON.stringify(block.input)}]`,
        );
        break;

      case "tool_result": {
        const text = extractToolResultText(block.content);
        parts.push(`[Tool result for ${block.tool_use_id}]: ${text}`);
        break;
      }
    }
  }
}

// The Copilot SDK expects a single flat prompt string, so we convert the
// structured Anthropic messages into that format.
export function formatAnthropicPrompt(
  messages: AnthropicMessage[],
  excludedFilePatterns: string[],
): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      if (msg.role === "user") {
        parts.push(
          `[User]: ${filterExcludedFiles(msg.content, excludedFilePatterns)}`,
        );
      } else {
        parts.push(`[Assistant]: ${msg.content}`);
      }
    } else {
      formatBlocks(msg.content, msg.role, excludedFilePatterns, parts);
    }
  }

  return parts.join("\n\n");
}
