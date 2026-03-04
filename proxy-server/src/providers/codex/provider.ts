import type { Provider } from "../types.js";
import { resolveToolBridgeManager } from "../../tool-bridge/index.js";
import {
  createResponsesHandler,
  extractFunctionCallOutputs,
  filterFunctionTools,
  genId,
} from "copilot-sdk-proxy";
import { asConversation } from "../../conversation-manager.js";
import { resolveResponsesToolResults } from "./tool-results.js";
import { handleResponsesStreaming, startResponseStream } from "./streaming.js";
import { createProviderSessionConfig } from "../shared/session-config.js";
import { filterExcludedFiles } from "../shared/prompt-utils.js";
import { addUserAgentGuard } from "../shared/user-agent-guard.js";
import { handleContinuation } from "../shared/continuation.js";
import { orchestrateStreaming } from "../shared/streaming-orchestrator.js";
import { UA_PREFIXES } from "../names.js";

export const codexProvider = {
  name: "Codex",
  routes: ["POST /v1/responses"],

  register(app, ctx) {
    addUserAgentGuard(app, UA_PREFIXES.codex, ctx.logger);

    const manager = resolveToolBridgeManager(app, ctx.toolBridgeManager, ctx.logger);
    const { logger, config, port, stats } = ctx;

    app.post("/v1/responses", createResponsesHandler(ctx, manager, {
      beforeHandler: async (req, reply) => {
        const callOutputs = extractFunctionCallOutputs(req.input);
        if (callOutputs.length === 0) return false;

        const existingConv = manager.findByContinuationIds(
          callOutputs.map((o) => o.call_id),
        );
        if (!existingConv) return false;

        return handleContinuation(
          asConversation(existingConv),
          reply,
          logger,
          {
            startStream: () => startResponseStream(reply, genId("resp"), req.model),
            resolveResults: () => { resolveResponsesToolResults(callOutputs, existingConv.state, logger); },
            countMessages: () => Array.isArray(req.input) ? req.input.length : 1,
          },
        );
      },

      onConversationReady: (conversation, req) => {
        const { state } = asConversation(conversation);
        const tools = req.tools ? filterFunctionTools(req.tools) : undefined;
        if (tools) state.setFilteredTools(tools);

        // Responses API tools use `parameters`, bridge uses `input_schema`
        if (tools?.length) {
          const bridgeTools = tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters ?? {},
          }));
          state.toolCache.cacheTools(bridgeTools);
        }
      },

      transformPrompt: (prompt) =>
        filterExcludedFiles(prompt, config.excludedFilePatterns),

      createSessionConfig: (baseOptions, conversation) => {
        const { state } = asConversation(conversation);
        return createProviderSessionConfig(baseOptions, { conversationId: conversation.id, tools: state.filteredTools, config, logger, port });
      },

      handleStreaming: async ({ conversation, session, prompt, model, reply, req, responseId }) => {
        const conv = asConversation(conversation);
        const tools = conv.state.filteredTools;
        const hasBridge = !!tools?.length && config.toolBridge;
        conv.state.replies.setReply(reply);

        await orchestrateStreaming({
          conversation: conv, logger, manager,
          messageCount: Array.isArray(req.input) ? req.input.length : 1,
          runStreaming: () => handleResponsesStreaming({ state: conv.state, session, prompt, model, logger, hasBridge, responseId, stats }),
        });
      },
    }));
  },
} satisfies Provider;
