import { extractContentText, type ChatCompletionMessage } from "./schemas.js";
import { filterExcludedFiles } from "../shared/prompt-utils.js";

export { filterExcludedFiles } from "../shared/prompt-utils.js";

// System/developer messages are skipped because they're passed separately via
// SessionConfig.systemMessage.
export function formatPrompt(
  messages: ChatCompletionMessage[],
  excludedFilePatterns: string[],
): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const content = extractContentText(msg.content);

    switch (msg.role) {
      case "system":
      case "developer":
        continue;

      case "user":
        parts.push(`[User]: ${filterExcludedFiles(content, excludedFilePatterns)}`);
        break;

      case "assistant":
        if (content) {
          parts.push(`[Assistant]: ${content}`);
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            parts.push(
              `[Assistant called tool ${tc.function.name} with args: ${tc.function.arguments}]`,
            );
          }
        }
        break;

      case "tool":
        parts.push(`[Tool result for ${msg.tool_call_id ?? "unknown"}]: ${content}`);
        break;

      case undefined:
        break;

      default:
        throw msg.role satisfies never;
    }
  }

  return parts.join("\n\n");
}
