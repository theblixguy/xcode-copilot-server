import type { FunctionCallOutputInput } from "./schemas.js";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import type { Logger } from "../../logger.js";

export function resolveResponsesToolResults(
  outputs: FunctionCallOutputInput[],
  state: ToolBridgeState,
  logger: Logger,
): void {
  for (const item of outputs) {
    logger.debug(`Resolving tool result for ${item.call_id}`);
    if (!state.resolveToolCall(item.call_id, item.output)) {
      logger.warn(`No pending MCP request for call_id ${item.call_id}`);
    }
  }
}
