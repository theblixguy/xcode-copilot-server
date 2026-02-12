import type { FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import type { Logger } from "../../logger.js";
import { formatCompaction, SSE_HEADERS, sendSSEEvent as sendEvent } from "../streaming-utils.js";
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

// Xcode doesn't know about the "xcode-bridge-" prefix the CLI adds
function stripMCPPrefix(name: string): string {
  return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
}

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

  // This listener outlives the initial HTTP response because during a
  // tool_use flow the reply gets ended, then Xcode sends a continuation
  // request that sets a new reply on state. So, we read state.currentReply
  // each time instead of closing over the original reply variable.
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
          // non-bridge tools (e.g. report_intent) are handled internally by the CLI
          const bridgeRequests = hasBridge
            ? event.data.toolRequests.filter((tr) => tr.name.startsWith(MCP_PREFIX))
            : event.data.toolRequests;

          if (hasBridge && bridgeRequests.length < event.data.toolRequests.length) {
            const skipped = event.data.toolRequests.length - bridgeRequests.length;
            logger.debug(`Skipped ${String(skipped)} non-bridge tool request(s) (handled internally by CLI)`);
          }

          // Xcode needs to see the names it originally sent, and the args
          // need to match the schema because the Copilot model sometimes
          // uses different naming conventions (e.g. "ignoreCase" vs "-i")
          const stripped = bridgeRequests.map((tr) => {
            const resolved = state.resolveToolName(stripMCPPrefix(tr.name));
            return {
              ...tr,
              name: resolved,
              arguments: state.normalizeArgs(
                resolved,
                (tr.arguments ?? {}) as Record<string, unknown>,
              ),
            };
          });

          if (stripped.length > 0) {
            // register even without a reply because the model might have retried
            // a tool after an internal failure
            for (const tr of stripped) {
              logger.info(`Tool request: name="${tr.name}", id="${tr.toolCallId}", args=${JSON.stringify(tr.arguments)}`);
              state.registerExpected(tr.toolCallId, tr.name);
            }

            const r = getReply();
            if (r) {
              flushPending();
              emitToolUseBlocks(r, stripped);
              finishReply(r, "tool_use");
            } else {
              logger.debug("assistant.message with tool requests but no reply (internal retry), registered expected tools");
            }
          } else {
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
          // spec requires at least one content block
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
        state.markSessionErrored();
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
      state.markSessionErrored();
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
