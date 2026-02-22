import type { FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import type { Logger } from "../../logger.js";
import type { Stats } from "../../stats.js";
import { formatCompaction, SSE_HEADERS } from "../shared/streaming-utils.js";
import { currentTimestamp, type ChatCompletionMessage, type ChatCompletionChunk } from "./schemas.js";

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export async function handleStreaming(
  reply: FastifyReply,
  session: CopilotSession,
  prompt: string,
  model: string,
  logger: Logger,
  stats?: Stats,
): Promise<boolean> {
  reply.raw.writeHead(200, SSE_HEADERS);

  const completionId = `chatcmpl-${String(Date.now())}`;

  function sendChunk(
    delta: Partial<ChatCompletionMessage>,
    finishReason: string | null,
  ): void {
    const chunk = {
      id: completionId,
      object: "chat.completion.chunk" as const,
      created: currentTimestamp(),
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
        },
      ],
    } satisfies ChatCompletionChunk;
    reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  sendChunk({ role: "assistant" }, null);

  const { promise, resolve } = Promise.withResolvers<boolean>();
  let done = false;

  function cleanup(): void {
    done = true;
    clearTimeout(timeout);
    unsubscribe();
  }

  reply.raw.on("close", () => {
    if (!done) {
      logger.info("Client disconnected, aborting session");
      cleanup();
      session.abort().catch((err: unknown) => {
        logger.error("Failed to abort session:", err);
      });
      resolve(false);
    }
  });

  const timeout = setTimeout(() => {
    logger.warn("Stream timed out after 5 minutes");
    cleanup();
    reply.raw.end();
    resolve(false);
  }, REQUEST_TIMEOUT_MS);

  // Buffer deltas so we can drop intermediate narration before tool calls
  let pendingDeltas: string[] = [];
  const toolNames = new Map<string, string>();

  function flushPending(): void {
    for (const text of pendingDeltas) {
      sendChunk({ content: text }, null);
    }
    pendingDeltas = [];
  }

  const unsubscribe = session.on((event) => {
    if (event.type === "tool.execution_start") {
      const d = event.data;
      toolNames.set(d.toolCallId, d.toolName);
      logger.debug(
        `Running ${d.toolName} (${JSON.stringify(d.arguments)})`,
      );
      return;
    }
    if (event.type === "tool.execution_complete") {
      const d = event.data;
      const name = toolNames.get(d.toolCallId) ?? d.toolCallId;
      toolNames.delete(d.toolCallId);
      const detail = d.success
        ? JSON.stringify(d.result?.content)
        : d.error?.message ?? "failed";
      logger.debug(`${name} done (${detail})`);
      return;
    }

    switch (event.type) {
      case "assistant.message_delta":
        if (event.data.deltaContent) {
          pendingDeltas.push(event.data.deltaContent);
        }
        break;

      case "assistant.message":
        if (event.data.toolRequests && event.data.toolRequests.length > 0) {
          logger.debug(
            `Calling tools (dropping buffered text): ${event.data.toolRequests.map((tr) => tr.name).join(", ")}`,
          );
          pendingDeltas = [];
        } else {
          flushPending();
        }
        break;

      case "session.idle":
        logger.info("Done, wrapping up stream");
        flushPending();
        cleanup();
        sendChunk({}, "stop");
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        resolve(true);
        break;

      case "session.compaction_start":
        logger.info("Compacting context...");
        break;

      case "session.compaction_complete":
        logger.info(`Context compacted: ${formatCompaction(event.data)}`);
        break;

      case "session.error":
        logger.error(`Session error: ${event.data.message}`);
        cleanup();
        reply.raw.end();
        resolve(false);
        break;

      case "assistant.usage":
        if (stats) {
          stats.recordUsage(event.data);
          logger.debug(`Usage: ${String(event.data.inputTokens ?? 0)} in, ${String(event.data.outputTokens ?? 0)} out, cost=${String(event.data.cost ?? 0)}`);
        }
        break;

      default:
        logger.debug(`Unhandled event: ${event.type}, data=${JSON.stringify(event.data)}`);
        break;
    }
  });

  session.send({ prompt }).catch((err: unknown) => {
    logger.error("Failed to send prompt:", err);
    if (!done) {
      cleanup();
      reply.raw.end();
    }
    resolve(false);
  });

  return promise;
}
