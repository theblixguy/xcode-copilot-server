import { extractContentText } from "../schemas.js";
import type { Message } from "../types.js";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips fenced code blocks whose header contains any of the given patterns
 * (case-insensitive). Xcode formats search results as fenced blocks with a
 * header like ` ```swift:/path/to/File.swift `, so the patterns are matched
 * against the file path in that header.
 *
 * Xcode's search results can include full file contents for every match, so
 * some files can be thousands of lines and add nothing useful to the prompt.
 * For example, a mock data file might match the search query but its contents
 * aren't helpful for generating a useful response.
 */
export function filterExcludedFiles(s: string, patterns: string[]): string {
  if (patterns.length === 0) return s;

  const joined = patterns.map(escapeRegex).join("|");
  const re = new RegExp(
    "```\\w*:[^\\n]*(?:" + joined + ")[^\\n]*\\n.*?\\n```\\n?",
    "gis",
  );
  return s.replace(re, "");
}

/** System/developer messages are skipped, because they're passed via `SessionConfig.systemMessage`. */
export function formatPrompt(
  messages: Message[],
  excludedFilePatterns: string[],
): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const content = extractContentText(msg.content);

    switch (msg.role) {
      case "system":
      case "developer":
        // Handled via SessionConfig.systemMessage
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
