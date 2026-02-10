import { extractContentText, type ChatCompletionMessage } from "../schemas/openai.js";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Xcode's search results can include full file contents for every match, so
// some files can be thousands of lines and add nothing useful to the prompt.
// This strips fenced code blocks whose header matches any of the given patterns
// (Xcode formats them as ```swift:/path/to/File.swift).
export function filterExcludedFiles(s: string, patterns: string[]): string {
  if (patterns.length === 0) return s;

  const joined = patterns.map(escapeRegex).join("|");
  const re = new RegExp(
    "```\\w*:[^\\n]*(?:" + joined + ")[^\\n]*\\n.*?\\n```\\n?",
    "gis",
  );
  return s.replace(re, "");
}

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
