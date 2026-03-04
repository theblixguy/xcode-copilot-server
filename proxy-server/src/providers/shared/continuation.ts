import type { FastifyReply } from "fastify";
import type { Logger } from "copilot-sdk-proxy";
import type { Conversation } from "../../conversation-manager.js";

interface ContinuationCallbacks {
  startStream: () => void;
  resolveResults: () => void;
  countMessages: () => number;
}

export async function handleContinuation(
  existingConv: Conversation,
  reply: FastifyReply,
  logger: Logger,
  callbacks: ContinuationCallbacks,
): Promise<boolean> {
  const { state } = existingConv;

  logger.info(`Continuation for conversation ${existingConv.id} (hasPending=${String(state.toolRouter.hasPending)}, sessionActive=${String(state.session.sessionActive)})`);

  if (state.session.sessionActive) {
    logger.warn(`Conversation ${existingConv.id} is already streaming, cannot handle continuation`);
    return false;
  }

  state.replies.setReply(reply);
  callbacks.startStream();

  reply.raw.on("close", () => {
    if (state.replies.currentReply === reply) {
      logger.info("Client disconnected during continuation");
      state.session.cleanup();
      state.replies.notifyStreamingDone();
    }
  });

  callbacks.resolveResults();
  await state.replies.waitForStreamingDone();
  existingConv.sentMessageCount = callbacks.countMessages();
  return true;
}
