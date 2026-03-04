import type { Logger } from "copilot-sdk-proxy";
import type { ConversationManager, Conversation } from "../../conversation-manager.js";

interface StreamingContext {
  conversation: Conversation;
  logger: Logger;
  manager: ConversationManager;
  messageCount: number;
  runStreaming: () => Promise<void>;
}

export async function orchestrateStreaming(ctx: StreamingContext): Promise<void> {
  const { conversation, logger, manager, messageCount } = ctx;
  const { state } = conversation;

  logger.info(`Streaming response for conversation ${conversation.id}`);
  await ctx.runStreaming();
  conversation.sentMessageCount = messageCount;

  if (conversation.isPrimary && state.session.hadError) {
    manager.clearPrimary();
  }
}
