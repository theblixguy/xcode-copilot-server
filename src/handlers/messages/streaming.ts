import type { FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import { formatCompaction, type Logger } from "../../logger.js";
import type {
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
} from "../../schemas/anthropic.js";
import type { ToolBridgeState } from "../../tool-bridge/state.js";

const MCP_PREFIX = "xcode-bridge-";

// The CLI prefixes MCP tool names with "xcode-bridge-" so we strip that
// before sending to Xcode, otherwise tool names won't match what Xcode expects.
function stripMCPPrefix(name: string): string {
  return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const satisfies Record<string, string>;

function sendEvent(reply: FastifyReply, type: string, data: unknown): void {
  reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// The text content block is started lazily once we actually have deltas to send,
// so this only emits the message_start envelope.
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
  state.markSessionActive();

  let pendingDeltas: string[] = [];
  let sessionDone = false;
  let textBlockStarted = false;

  const toolNames = new Map<string, string>();

  function getReply(): FastifyReply | null {
    return state.currentReply;
  }

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

  function flushPending(): void {
    const r = getReply();
    if (!r || pendingDeltas.length === 0) return;
    ensureTextBlock(r);
    for (const text of pendingDeltas) {
      const delta: ContentBlockDeltaEvent = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      };
      sendEvent(r, "content_block_delta", delta);
    }
    pendingDeltas = [];
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
    toolRequests: Array<{ toolCallId: string; name: string; arguments?: unknown }>,
  ): void {
    // Close the text block first if one was started (model said text before tools)
    let startIndex: number;
    if (textBlockStarted) {
      sendEvent(r, "content_block_stop", {
        type: "content_block_stop",
        index: 0,
      } satisfies ContentBlockStopEvent);
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

  function finishReply(r: FastifyReply, stopReason: string): void {
    if (stopReason === "end_turn" && textBlockStarted) {
      sendEvent(r, "content_block_stop", {
        type: "content_block_stop",
        index: 0,
      } satisfies ContentBlockStopEvent);
    }
    sendEpilogue(r, stopReason);
    r.raw.end();
    state.clearReply();
    state.notifyStreamingDone();
    textBlockStarted = false;
  }

  const unsubscribe = session.on((event) => {
    logger.debug(`Session event: ${event.type}`);

    if (event.type === "tool.execution_start") {
      const d = event.data;
      toolNames.set(d.toolCallId, d.toolName);
      logger.debug(`Running ${d.toolName} (id=${d.toolCallId}, args=${JSON.stringify(d.arguments)})`);
      return;
    }
    if (event.type === "tool.execution_complete") {
      const d = event.data;
      const name = toolNames.get(d.toolCallId) ?? d.toolCallId;
      toolNames.delete(d.toolCallId);
      const detail = d.success
        ? JSON.stringify(d.result?.content)
        : d.error?.message ?? "failed";
      logger.debug(`${name} done (success=${String(d.success)}, ${detail})`);
      return;
    }

    switch (event.type) {
      case "assistant.message_delta":
        if (event.data.deltaContent) {
          logger.debug(`Delta: ${event.data.deltaContent}`);
          pendingDeltas.push(event.data.deltaContent);
        }
        break;

      case "assistant.message": {
        logger.debug(`assistant.message: toolRequests=${String(event.data.toolRequests?.length ?? 0)}, content=${JSON.stringify(event.data)}`);

        if (event.data.toolRequests && event.data.toolRequests.length > 0) {
          // Only forward tools that came through the MCP shim when the bridge
          // is active, since non-bridge tools (e.g. report_intent) are denied
          // by the onPreToolUse hook and handled internally by the CLI.
          const bridgeRequests = hasBridge
            ? event.data.toolRequests.filter((tr) => tr.name.startsWith(MCP_PREFIX))
            : event.data.toolRequests;

          if (hasBridge && bridgeRequests.length < event.data.toolRequests.length) {
            const skipped = event.data.toolRequests.length - bridgeRequests.length;
            logger.debug(`Skipped ${String(skipped)} non-bridge tool request(s) (handled internally by CLI)`);
          }

          // Strip MCP prefix and resolve hallucinated names so the tool_use
          // blocks sent to Xcode match the names it originally provided.
          const stripped = bridgeRequests.map((tr) => ({
            ...tr,
            name: state.resolveToolName(stripMCPPrefix(tr.name)),
          }));

          if (stripped.length > 0) {
            // Register expected tools even without a reply so that incoming MCP
            // requests can still be matched, e.g. when the model retried a tool
            // after an internal failure.
            for (const tr of stripped) {
              logger.info(`Tool request: name="${tr.name}", id="${tr.toolCallId}", args=${JSON.stringify(tr.arguments)}`);
              state.registerExpected(tr.toolCallId, tr.name);
            }

            const r = getReply();
            if (r) {
              // Flush any accumulated text before tool_use blocks (preserves
              // the model's text like "Let me read the file" alongside tools)
              flushPending();
              emitToolUseBlocks(r, stripped);
              finishReply(r, "tool_use");
            } else {
              // No reply available because the model retried a tool after an
              // internal CLI failure. The MCP shim will still call
              // /internal/tool-call and the next continuation from Xcode will
              // provide the result.
              logger.debug("assistant.message with tool requests but no reply (internal retry), registered expected tools");
            }
          } else {
            // All tool requests were non-bridge (denied by hook), so don't
            // emit any tool_use blocks. The CLI handles the denials internally
            // and the model will continue with another response.
            logger.debug("All tool requests were non-bridge, no tool_use blocks emitted");
          }
        } else {
          const r = getReply();
          if (r) {
            logger.debug(`assistant.message with no tool requests, flushing ${String(pendingDeltas.length)} pending deltas`);
            flushPending();
          }
        }
        break;
      }

      case "session.idle": {
        logger.info(`Done, wrapping up stream (pendingDeltas=${String(pendingDeltas.length)})`);
        sessionDone = true;
        state.markSessionInactive();
        flushPending();
        const r = getReply();
        if (r) {
          // Ensure at least one content block for spec compliance
          if (!textBlockStarted) {
            ensureTextBlock(r);
          }
          finishReply(r, "end_turn");
        }
        unsubscribe();
        break;
      }

      case "session.compaction_start":
        logger.info("Compacting context...");
        break;

      case "session.compaction_complete":
        logger.info(`Context compacted: ${formatCompaction(event.data)}`);
        break;

      case "session.error": {
        logger.error(`Session error: ${event.data.message}`);
        sessionDone = true;
        state.markSessionInactive();
        const r = getReply();
        if (r) {
          if (textBlockStarted) {
            sendEvent(r, "content_block_stop", {
              type: "content_block_stop",
              index: 0,
            } satisfies ContentBlockStopEvent);
          }
          sendEpilogue(r, "end_turn");
          r.raw.end();
          state.clearReply();
        }
        textBlockStarted = false;
        unsubscribe();
        state.notifyStreamingDone();
        break;
      }

      default:
        logger.debug(`Unhandled event: ${event.type}, data=${JSON.stringify(event.data)}`);
        break;
    }
  });

  reply.raw.on("close", () => {
    if (!sessionDone && state.currentReply === reply) {
      logger.info("Client disconnected, aborting session");
      textBlockStarted = false;
      state.cleanup();
      unsubscribe();
      session.abort().catch((err: unknown) => {
        logger.error("Failed to abort session:", err);
      });
      state.notifyStreamingDone();
    }
  });

  const done = state.waitForStreamingDone();

  session.send({ prompt }).catch((err: unknown) => {
    logger.error("Failed to send prompt:", err);
    sessionDone = true;
    textBlockStarted = false;
    const r = getReply();
    if (r) {
      r.raw.end();
      state.clearReply();
    }
    unsubscribe();
    state.notifyStreamingDone();
  });

  return done;
}
