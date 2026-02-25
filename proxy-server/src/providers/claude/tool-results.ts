import type { AnthropicMessage, Logger } from "copilot-sdk-proxy";
import type { ToolBridgeState } from "../../tool-bridge/state.js";

export function resolveToolResults(
  messages: AnthropicMessage[],
  state: ToolBridgeState,
  logger: Logger,
): void {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || typeof lastMsg.content === "string") return;

  for (const block of lastMsg.content) {
    if (block.type === "tool_result") {
      const resultText = typeof block.content === "string"
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((b) => b.text).join("\n")
          : "";
      logger.debug(`Resolving tool result for ${block.tool_use_id}`);
      if (!state.resolveToolCall(block.tool_use_id, resultText)) {
        logger.warn(`No pending MCP request for tool_use_id ${block.tool_use_id}`);
      }
    }
  }
}
