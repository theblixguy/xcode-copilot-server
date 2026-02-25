import type { FastifyReply } from "fastify";
import type { CopilotSession, Logger, Stats, FunctionCallOutputItem } from "copilot-sdk-proxy";
import {
  sendSSEEvent as sendEvent,
  sendSSEComment,
  genId,
  nextSeq,
  startResponseStream,
  ResponsesProtocol,
} from "copilot-sdk-proxy";
import type { SeqCounter } from "copilot-sdk-proxy";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import type { BridgeStreamProtocol, StrippedToolRequest } from "../shared/streaming-core.js";
import { runSessionStreaming } from "../shared/streaming-core.js";

export { type SeqCounter, startResponseStream };

class BridgeResponsesProtocol extends ResponsesProtocol implements BridgeStreamProtocol {
  private readonly keepaliveInterval: ReturnType<typeof setInterval>;
  private readonly getReply: () => FastifyReply | null;

  constructor(
    responseId: string,
    model: string,
    seq: SeqCounter,
    getReply: () => FastifyReply | null,
  ) {
    super(responseId, model, seq);
    this.getReply = getReply;
    // Keepalive every 15s so the client doesn't time out while
    // waiting for internal tool execution to finish
    this.keepaliveInterval = setInterval(() => {
      const r = this.getReply();
      if (r) sendSSEComment(r);
    }, 15_000);
  }

  private emitFunctionCallItems(
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
        output_index: this.outputIndex,
        item: fcItem,
      }, nextSeq(this.seq));

      const doneItem: FunctionCallOutputItem = { ...fcItem, status: "completed" };
      sendEvent(r, "response.output_item.done", {
        output_index: this.outputIndex,
        item: doneItem,
      }, nextSeq(this.seq));

      this.outputItems.push(doneItem);
      this.outputIndex++;
    }
  }

  emitToolsAndFinish(r: FastifyReply, tools: StrippedToolRequest[]): void {
    this.closeMessageItem(r);
    this.emitFunctionCallItems(r, tools);
    this.sendResponseEnvelope(r, "completed");
  }

  override teardown(): void {
    clearInterval(this.keepaliveInterval);
  }

  reset(): void {
    this.messageStarted = false;
    this.messageItem = null;
    this.outputIndex = 0;
    this.outputItems.length = 0;
    this.accumulatedText.length = 0;
    // Sequence numbers must keep incrementing across tool-call cycles
    // within the same response, so we deliberately leave seq alone.
  }
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

  const protocol = new BridgeResponsesProtocol(responseId, model, seq, () => state.currentReply);
  return runSessionStreaming(state, session, prompt, logger, hasBridge, protocol, reply, stats);
}
