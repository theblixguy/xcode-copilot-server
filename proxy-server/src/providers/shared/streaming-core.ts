import type { FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import type { Logger } from "../../logger.js";
import type { Stats } from "../../stats.js";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import { BRIDGE_TOOL_PREFIX } from "../../tool-bridge/index.js";
import { formatCompaction, recordUsageEvent } from "./streaming-utils.js";

// Xcode doesn't know about the bridge prefix so we strip it
export function stripBridgePrefix(name: string): string {
  return name.startsWith(BRIDGE_TOOL_PREFIX) ? name.slice(BRIDGE_TOOL_PREFIX.length) : name;
}

export interface StrippedToolRequest {
  toolCallId: string;
  name: string;
  arguments?: unknown;
}

// The core handles session events, state management, and bridge logic;
// each protocol just handles serializing events to the client.
export interface StreamProtocol {
  flushDeltas(reply: FastifyReply, deltas: string[]): void;
  emitToolsAndFinish(reply: FastifyReply, tools: StrippedToolRequest[]): void;
  sendCompleted(reply: FastifyReply): void;
  sendFailed(reply: FastifyReply): void;
  teardown(): void;
  reset(): void;
}

export async function runSessionStreaming(
  state: ToolBridgeState,
  session: CopilotSession,
  prompt: string,
  logger: Logger,
  hasBridge: boolean,
  protocol: StreamProtocol,
  initialReply: FastifyReply,
  stats: Stats,
): Promise<void> {
  state.markSessionActive();

  let pendingDeltas: string[] = [];
  let sessionDone = false;
  const toolNames = new Map<string, string>();

  function getReply(): FastifyReply | null {
    return state.currentReply;
  }

  function flushToProtocol(): void {
    if (pendingDeltas.length === 0) return;
    const r = getReply();
    if (!r) return;
    protocol.flushDeltas(r, pendingDeltas);
    pendingDeltas = [];
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
        logger.debug(`assistant.message: toolRequests=${String(event.data.toolRequests?.length ?? 0)}`);

        if (event.data.toolRequests && event.data.toolRequests.length > 0) {
          const bridgeRequests = hasBridge
            ? event.data.toolRequests.filter((tr) => tr.name.startsWith(BRIDGE_TOOL_PREFIX))
            : event.data.toolRequests;

          if (hasBridge && bridgeRequests.length < event.data.toolRequests.length) {
            const skipped = event.data.toolRequests.length - bridgeRequests.length;
            logger.debug(`Skipped ${String(skipped)} non-bridge tool request(s) (handled internally by CLI)`);
          }

          const stripped: StrippedToolRequest[] = bridgeRequests.map((tr) => {
            const resolved = state.resolveToolName(stripBridgePrefix(tr.name));
            return {
              toolCallId: tr.toolCallId,
              name: resolved,
              arguments: state.normalizeArgs(
                resolved,
                (tr.arguments ?? {}) as Record<string, unknown>,
              ),
            };
          });

          if (stripped.length > 0) {
            for (const tr of stripped) {
              logger.info(`Tool request: name="${tr.name}", id="${tr.toolCallId}", args=${JSON.stringify(tr.arguments)}`);
              state.registerExpected(tr.toolCallId, tr.name);
            }

            const r = getReply();
            if (r) {
              flushToProtocol();
              protocol.emitToolsAndFinish(r, stripped);
              r.raw.end();
              state.clearReply();
              protocol.reset();
              state.notifyStreamingDone();
            } else {
              logger.debug("Tool requests but no reply (internal retry), registered expected tools");
            }
          } else {
            logger.debug("All tool requests were non-bridge, none emitted");
          }
        } else {
          const r = getReply();
          if (r) {
            logger.debug(`Flushing ${String(pendingDeltas.length)} pending deltas`);
            flushToProtocol();
          }
        }
        break;
      }

      case "session.idle": {
        logger.info(`Done, wrapping up stream (pendingDeltas=${String(pendingDeltas.length)})`);
        sessionDone = true;
        state.markSessionInactive();
        flushToProtocol();
        const r = getReply();
        if (r) {
          protocol.sendCompleted(r);
          protocol.teardown();
          r.raw.end();
          state.clearReply();
          state.notifyStreamingDone();
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
          protocol.sendFailed(r);
          protocol.teardown();
          r.raw.end();
          state.clearReply();
        } else {
          protocol.teardown();
        }
        state.notifyStreamingDone();
        unsubscribe();
        break;
      }

      case "assistant.usage":
        recordUsageEvent(stats, logger, event.data);
        break;

      default:
        logger.debug(`Unhandled event: ${event.type}, data=${JSON.stringify(event.data)}`);
        break;
    }
  });

  initialReply.raw.on("close", () => {
    if (!sessionDone && state.currentReply === initialReply) {
      logger.info("Client disconnected, aborting session");
      protocol.teardown();
      protocol.reset();
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
    if (sessionDone) return;
    logger.error("Failed to send prompt:", err);
    sessionDone = true;
    protocol.teardown();
    protocol.reset();
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
