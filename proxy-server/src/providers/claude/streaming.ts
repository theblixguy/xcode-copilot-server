import type { FastifyReply } from "fastify";
import type { CopilotSession, Logger, Stats, ContentBlockStopEvent } from "copilot-sdk-proxy";
import {
  sendSSEEvent as sendEvent,
  startReply,
  AnthropicProtocol,
} from "copilot-sdk-proxy";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import type { BridgeStreamProtocol, StrippedToolRequest } from "../shared/streaming-core.js";
import { runSessionStreaming } from "../shared/streaming-core.js";

export { startReply };

class BridgeAnthropicProtocol extends AnthropicProtocol implements BridgeStreamProtocol {
  private emitToolUseBlocks(
    r: FastifyReply,
    toolRequests: StrippedToolRequest[],
  ): void {
    let startIndex: number;
    if (this.textBlockStarted) {
      this.sendBlockStop(r);
      startIndex = 1;
    } else {
      startIndex = 0;
    }

    let index = startIndex;
    for (const tr of toolRequests) {
      sendEvent(r, "content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: tr.toolCallId, name: tr.name, input: {} },
      });

      const argsJson = tr.arguments != null ? JSON.stringify(tr.arguments) : "{}";
      sendEvent(r, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: argsJson },
      });

      sendEvent(r, "content_block_stop", {
        type: "content_block_stop",
        index,
      } satisfies ContentBlockStopEvent);

      index++;
    }
  }

  emitToolsAndFinish(r: FastifyReply, tools: StrippedToolRequest[]): void {
    this.emitToolUseBlocks(r, tools);
    this.sendEpilogue(r, "tool_use");
  }

  reset(): void {
    this.textBlockStarted = false;
  }
}

export async function handleAnthropicStreaming(
  state: ToolBridgeState,
  session: CopilotSession,
  prompt: string,
  model: string,
  logger: Logger,
  hasBridge: boolean,
  stats: Stats,
): Promise<void> {
  const reply = state.currentReply;
  if (!reply) throw new Error("No reply set on bridge state");
  startReply(reply, model);

  const protocol = new BridgeAnthropicProtocol();
  return runSessionStreaming(state, session, prompt, logger, hasBridge, protocol, reply, stats);
}
