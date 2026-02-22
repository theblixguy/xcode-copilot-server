import type { FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import type { Logger } from "../../logger.js";
import type { Stats } from "../../stats.js";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import type {
  ResponseObject,
  MessageOutputItem,
  FunctionCallOutputItem,
  OutputItem,
} from "./schemas.js";
import { currentTimestamp, genId } from "./schemas.js";
import { SSE_HEADERS, sendSSEEvent as sendEvent, sendSSEComment } from "../shared/streaming-utils.js";
import type { StreamProtocol, StrippedToolRequest } from "../shared/streaming-core.js";
import { runSessionStreaming } from "../shared/streaming-core.js";

export interface SeqCounter {
  value: number;
}

function nextSeq(counter: SeqCounter): number {
  return counter.value++;
}

export function startResponseStream(
  reply: FastifyReply,
  responseId: string,
  model: string,
  seq?: SeqCounter,
): SeqCounter {
  const counter = seq ?? { value: 0 };
  reply.raw.writeHead(200, SSE_HEADERS);

  const response: ResponseObject = {
    id: responseId,
    object: "response",
    created_at: currentTimestamp(),
    model,
    status: "in_progress",
    output: [],
  };

  sendEvent(reply, "response.created", { response }, nextSeq(counter));
  sendEvent(reply, "response.in_progress", { response }, nextSeq(counter));
  return counter;
}

function createResponsesProtocol(
  responseId: string,
  model: string,
  seq: SeqCounter,
  getReply: () => FastifyReply | null,
): StreamProtocol {
  let messageItem: MessageOutputItem | null = null;
  let messageStarted = false;
  let outputIndex = 0;
  const outputItems: OutputItem[] = [];
  const accumulatedText: string[] = [];

  // Keepalive every 15s so the client doesn't time out while
  // waiting for internal tool execution to finish
  const keepaliveInterval = setInterval(() => {
    const r = getReply();
    if (r) sendSSEComment(r);
  }, 15_000);

  function ensureMessageItem(r: FastifyReply): void {
    if (!messageStarted) {
      messageItem = {
        type: "message",
        id: genId("msg"),
        status: "in_progress",
        role: "assistant",
        content: [],
      };
      sendEvent(r, "response.output_item.added", {
        output_index: outputIndex,
        item: messageItem,
      }, nextSeq(seq));
      sendEvent(r, "response.content_part.added", {
        item_id: messageItem.id,
        output_index: outputIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      }, nextSeq(seq));
      messageStarted = true;
    }
  }

  function closeMessageItem(r: FastifyReply): void {
    if (!messageStarted || !messageItem) return;

    const fullText = accumulatedText.join("");
    sendEvent(r, "response.output_text.done", {
      item_id: messageItem.id,
      output_index: outputIndex,
      content_index: 0,
      text: fullText,
    }, nextSeq(seq));
    sendEvent(r, "response.content_part.done", {
      item_id: messageItem.id,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: fullText, annotations: [] },
    }, nextSeq(seq));

    messageItem.status = "completed";
    messageItem.content = [{ type: "output_text", text: fullText, annotations: [] }];
    outputItems.push(messageItem);
    sendEvent(r, "response.output_item.done", {
      output_index: outputIndex,
      item: messageItem,
    }, nextSeq(seq));

    outputIndex++;
    messageStarted = false;
    messageItem = null;
  }

  function emitFunctionCallItems(
    r: FastifyReply,
    toolRequests: StrippedToolRequest[],
  ): void {
    for (const tr of toolRequests) {
      const callId = tr.toolCallId;
      const itemId = genId("fc");
      const argsJson = tr.arguments != null ? JSON.stringify(tr.arguments) : "{}";

      const fcItem: FunctionCallOutputItem = {
        type: "function_call",
        id: itemId,
        call_id: callId,
        name: tr.name,
        arguments: argsJson,
        status: "in_progress",
      };

      sendEvent(r, "response.output_item.added", {
        output_index: outputIndex,
        item: fcItem,
      }, nextSeq(seq));

      const doneItem: FunctionCallOutputItem = { ...fcItem, status: "completed" };
      sendEvent(r, "response.output_item.done", {
        output_index: outputIndex,
        item: doneItem,
      }, nextSeq(seq));

      outputItems.push(doneItem);
      outputIndex++;
    }
  }

  function sendResponseEnvelope(r: FastifyReply, status: ResponseObject["status"]): void {
    const response: ResponseObject = {
      id: responseId,
      object: "response",
      created_at: currentTimestamp(),
      model,
      status,
      output: outputItems,
    };
    sendEvent(r, `response.${status}`, { response }, nextSeq(seq));
  }

  return {
    flushDeltas(r: FastifyReply, deltas: string[]): void {
      ensureMessageItem(r);
      if (!messageItem) return;
      for (const text of deltas) {
        sendEvent(r, "response.output_text.delta", {
          item_id: messageItem.id,
          output_index: outputIndex,
          content_index: 0,
          delta: text,
        }, nextSeq(seq));
        accumulatedText.push(text);
      }
    },

    emitToolsAndFinish(r: FastifyReply, tools: StrippedToolRequest[]): void {
      closeMessageItem(r);
      emitFunctionCallItems(r, tools);
      sendResponseEnvelope(r, "completed");
    },

    sendCompleted(r: FastifyReply): void {
      if (!messageStarted) ensureMessageItem(r);
      closeMessageItem(r);
      sendResponseEnvelope(r, "completed");
    },

    sendFailed(r: FastifyReply): void {
      if (messageStarted) closeMessageItem(r);
      sendResponseEnvelope(r, "failed");
    },

    teardown(): void {
      clearInterval(keepaliveInterval);
    },

    reset(): void {
      messageStarted = false;
      messageItem = null;
      outputIndex = 0;
      outputItems.length = 0;
      accumulatedText.length = 0;
    },
  };
}

export async function handleResponsesStreaming(
  state: ToolBridgeState,
  session: CopilotSession,
  prompt: string,
  model: string,
  logger: Logger,
  hasBridge: boolean,
  responseId: string,
  stats: Stats,
): Promise<void> {
  const reply = state.currentReply;
  if (!reply) throw new Error("No reply set on bridge state");
  const seq = startResponseStream(reply, responseId, model);

  const protocol = createResponsesProtocol(responseId, model, seq, () => state.currentReply);
  return runSessionStreaming(state, session, prompt, logger, hasBridge, protocol, reply, stats);
}
