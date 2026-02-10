import type { FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import { formatCompaction, type Logger } from "../../logger.js";
import { currentTimestamp, type ChatCompletionMessage, type ChatCompletionChunk } from "../../schemas/openai.js";

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export async function handleStreaming(
  reply: FastifyReply,
  session: CopilotSession,
  prompt: string,
  model: string,
  logger: Logger,
): Promise<void> {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const completionId = `chatcmpl-${String(Date.now())}`;

  function sendChunk(
    delta: Partial<ChatCompletionMessage>,
    finishReason: string | null,
  ): void {
    const chunk: ChatCompletionChunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created: currentTimestamp(),
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
        },
      ],
    };
    reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  sendChunk({ role: "assistant" }, null);

  const { promise, resolve } = Promise.withResolvers<undefined>();
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
      resolve(undefined);
    }
  });

  const timeout = setTimeout(() => {
    logger.warn("Stream timed out after 5 minutes");
    cleanup();
    reply.raw.end();
    resolve(undefined);
  }, REQUEST_TIMEOUT_MS);

  // Buffer deltas so we can discard intermediate narration
  // (e.g. "Let me search...") that precedes tool calls.
  let pendingDeltas: string[] = [];

  // Track tool names by call ID so we can log them on completion
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
          // Intermediate turn, so discard buffered narration.
          logger.debug(
            `Calling tools (dropping buffered text): ${event.data.toolRequests.map((tr) => tr.name).join(", ")}`,
          );
          pendingDeltas = [];
        } else {
          // Final turn, so flush buffered deltas to the client.
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
        resolve(undefined);
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
        resolve(undefined);
        break;
    }
  });

  session.send({ prompt }).catch((err: unknown) => {
    logger.error("Failed to send prompt:", err);
    if (!done) {
      cleanup();
      reply.raw.end();
    }
    resolve(undefined);
  });

  return promise;
}
