import type { FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import type { Logger } from "../../logger.js";
import { SSE_HEADERS, sendSSEEvent as sendEvent } from "../shared/streaming-utils.js";
import type {
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
} from "./schemas.js";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import type { StreamProtocol, StrippedToolRequest } from "../shared/streaming-core.js";
import { runSessionStreaming } from "../shared/streaming-core.js";

export function startReply(reply: FastifyReply, model: string): void {
  reply.raw.writeHead(200, SSE_HEADERS);

  const messageStart: MessageStartEvent = {
    type: "message_start",
    message: {
      id: `msg_${String(Date.now())}`,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
  sendEvent(reply, "message_start", messageStart);
}

function createAnthropicProtocol(): StreamProtocol {
  let textBlockStarted = false;

  function ensureTextBlock(r: FastifyReply): void {
    if (!textBlockStarted) {
      const blockStart: ContentBlockStartEvent = {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      };
      sendEvent(r, "content_block_start", blockStart);
      textBlockStarted = true;
    }
  }

  function sendBlockStop(r: FastifyReply): void {
    sendEvent(r, "content_block_stop", {
      type: "content_block_stop",
      index: 0,
    } satisfies ContentBlockStopEvent);
  }

  function sendEpilogue(r: FastifyReply, stopReason: string): void {
    const messageDelta: MessageDeltaEvent = {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    };
    sendEvent(r, "message_delta", messageDelta);
    sendEvent(r, "message_stop", { type: "message_stop" } satisfies MessageStopEvent);
  }

  function emitToolUseBlocks(
    r: FastifyReply,
    toolRequests: StrippedToolRequest[],
  ): void {
    let startIndex: number;
    if (textBlockStarted) {
      sendBlockStop(r);
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

  return {
    flushDeltas(r: FastifyReply, deltas: string[]): void {
      ensureTextBlock(r);
      for (const text of deltas) {
        const delta: ContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        };
        sendEvent(r, "content_block_delta", delta);
      }
    },

    emitToolsAndFinish(r: FastifyReply, tools: StrippedToolRequest[]): void {
      emitToolUseBlocks(r, tools);
      sendEpilogue(r, "tool_use");
    },

    sendCompleted(r: FastifyReply): void {
      ensureTextBlock(r);
      sendBlockStop(r);
      sendEpilogue(r, "end_turn");
    },

    sendFailed(r: FastifyReply): void {
      if (textBlockStarted) sendBlockStop(r);
      sendEpilogue(r, "end_turn");
    },

    teardown(): void {},

    reset(): void {
      textBlockStarted = false;
    },
  };
}

export async function handleAnthropicStreaming(
  state: ToolBridgeState,
  session: CopilotSession,
  prompt: string,
  model: string,
  logger: Logger,
  hasBridge = false,
): Promise<void> {
  const reply = state.currentReply;
  if (!reply) throw new Error("No reply set on bridge state");
  startReply(reply, model);

  const protocol = createAnthropicProtocol();
  return runSessionStreaming(state, session, prompt, logger, hasBridge, protocol, reply);
}
