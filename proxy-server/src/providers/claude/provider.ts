import type { Provider } from "../types.js";
import { resolveToolBridgeManager } from "../../tool-bridge/index.js";
import {
  createMessagesHandler,
  createCountTokensHandler,
  type AnthropicMessage,
} from "copilot-sdk-proxy";
import { asConversation } from "../../conversation-manager.js";
import { resolveToolResults } from "./tool-results.js";
import { handleAnthropicStreaming, startReply } from "./streaming.js";
import { createProviderSessionConfig } from "../shared/session-config.js";
import { filterExcludedFiles } from "../shared/prompt-utils.js";
import { addUserAgentGuard } from "../shared/user-agent-guard.js";
import { handleContinuation } from "../shared/continuation.js";
import { orchestrateStreaming } from "../shared/streaming-orchestrator.js";
import { UA_PREFIXES } from "../names.js";

function extractToolResultIds(messages: AnthropicMessage[]): string[] {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || typeof lastMsg.content === "string") {
    return [];
  }
  const ids: string[] = [];
  for (const block of lastMsg.content) {
    if (block.type === "tool_result") {
      ids.push(block.tool_use_id);
    }
  }
  return ids;
}

export const claudeProvider = {
  name: "Claude",
  routes: ["POST /v1/messages", "POST /v1/messages/count_tokens"],

  register(app, ctx) {
    addUserAgentGuard(app, UA_PREFIXES.claude, ctx.logger);

    const manager = resolveToolBridgeManager(app, ctx.toolBridgeManager, ctx.logger);
    const { logger, config, port, stats } = ctx;

    app.post("/v1/messages", createMessagesHandler(ctx, manager, {
      beforeHandler: async (req, reply) => {
        const toolResultIds = extractToolResultIds(req.messages);
        if (toolResultIds.length === 0) return false;

        const existingConv = manager.findByContinuationIds(toolResultIds);
        if (!existingConv) return false;

        return handleContinuation(
          asConversation(existingConv),
          reply,
          logger,
          {
            startStream: () => { startReply(reply, req.model); },
            resolveResults: () => { resolveToolResults(req.messages, existingConv.state, logger); },
            countMessages: () => req.messages.length,
          },
        );
      },

      onConversationReady: (conversation, req) => {
        const { state } = asConversation(conversation);
        const tools = req.tools;
        if (tools?.length) {
          state.toolCache.cacheTools(tools);
        }
      },

      transformPrompt: (prompt) =>
        filterExcludedFiles(prompt, config.excludedFilePatterns),

      createSessionConfig: (baseOptions, conversation, req) =>
        createProviderSessionConfig(baseOptions, { conversationId: conversation.id, tools: req.tools, config, logger, port }),

      handleStreaming: async ({ conversation, session, prompt, model, reply, req }) => {
        const conv = asConversation(conversation);
        const hasBridge = !!req.tools?.length && config.toolBridge;
        conv.state.replies.setReply(reply);

        await orchestrateStreaming({
          conversation: conv, logger, manager,
          messageCount: req.messages.length,
          runStreaming: () => handleAnthropicStreaming({ state: conv.state, session, prompt, model, logger, hasBridge, stats }),
        });
      },
    }));

    app.post("/v1/messages/count_tokens", createCountTokensHandler(ctx));
  },
} satisfies Provider;
