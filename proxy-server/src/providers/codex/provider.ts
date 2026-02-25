import type { Provider } from "../types.js";
import { registerToolBridge } from "../../tool-bridge/index.js";
import {
  createResponsesHandler,
  extractFunctionCallOutputs,
  filterFunctionTools,
  genId,
} from "copilot-sdk-proxy";
import type { Conversation } from "../../conversation-manager.js";
import { resolveResponsesToolResults } from "./tool-results.js";
import { handleResponsesStreaming, startResponseStream } from "./streaming.js";
import { createSessionConfig } from "../shared/session-config.js";
import { filterExcludedFiles } from "../shared/prompt-utils.js";

export const codexProvider = {
  name: "Codex",
  routes: ["POST /v1/responses"],

  register(app, ctx) {
    app.addHook("onRequest", (request, reply, done) => {
      if (request.url.startsWith("/mcp/")) {
        done();
        return;
      }
      const ua = request.headers["user-agent"] ?? "";
      if (!ua.startsWith("Xcode/")) {
        ctx.logger.warn(`Rejected request from unexpected user-agent: ${ua}`);
        void reply.code(403).type("application/json").send('{"error":"Forbidden"}\n');
        return;
      }
      done();
    });

    const manager = registerToolBridge(app, ctx.logger);
    const { logger, config, port, stats } = ctx;

    app.post("/v1/responses", createResponsesHandler(ctx, manager, {
      beforeHandler: async (req, reply) => {
        const callOutputs = extractFunctionCallOutputs(req.input);
        logger.debug(`function_call_output items: ${String(callOutputs.length)}${callOutputs.length > 0 ? ` (call_ids: ${callOutputs.map((o) => o.call_id).join(", ")})` : ""}`);

        if (callOutputs.length === 0) return false;

        const existingConv = manager.findByContinuationIds(
          callOutputs.map((o) => o.call_id),
        );
        if (!existingConv) return false;

        const state = existingConv.state;
        logger.info(`Continuation for conversation ${existingConv.id} (hasPending=${String(state.hasPending)}, sessionActive=${String(state.sessionActive)})`);
        state.setReply(reply);
        startResponseStream(reply, genId("resp"), req.model);

        reply.raw.on("close", () => {
          if (state.currentReply === reply) {
            logger.info("Client disconnected during continuation");
            state.cleanup();
            state.notifyStreamingDone();
          }
        });

        resolveResponsesToolResults(callOutputs, state, logger);
        await state.waitForStreamingDone();
        existingConv.sentMessageCount = Array.isArray(req.input) ? req.input.length : 1;
        return true;
      },

      onConversationReady: (conversation, req) => {
        const { state } = conversation as Conversation;
        const tools = req.tools ? filterFunctionTools(req.tools) : undefined;

        // Responses API tools use `parameters`, bridge uses `input_schema`
        if (tools?.length) {
          const bridgeTools = tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters ?? {},
          }));
          state.cacheTools(bridgeTools);
        }
      },

      transformPrompt: (prompt) =>
        filterExcludedFiles(prompt, config.excludedFilePatterns),

      createSessionConfig: (baseOptions, conversation, req) => {
        const tools = req.tools ? filterFunctionTools(req.tools) : undefined;
        const hasBridge = !!tools?.length && config.toolBridge;

        if (tools) {
          logger.debug(`Tools in request: ${String(tools.length)}`);
          logger.debug(`Tool names: ${tools.map((t) => t.name).join(", ")}`);
        }
        if (hasBridge) {
          logger.info("Tool bridge active (in-process MCP)");
        }

        return createSessionConfig({
          ...baseOptions,
          config,
          hasToolBridge: hasBridge,
          port,
          conversationId: conversation.id,
        });
      },

      handleStreaming: async ({ conversation, session, prompt, model, reply, req, responseId }) => {
        const { state } = conversation as Conversation;
        const tools = req.tools ? filterFunctionTools(req.tools) : undefined;
        const hasBridge = !!tools?.length && config.toolBridge;
        state.setReply(reply);

        const inputLength = Array.isArray(req.input) ? req.input.length : 1;

        logger.info(`Streaming response for conversation ${conversation.id}`);
        await handleResponsesStreaming(state, session, prompt, model, logger, hasBridge, responseId, stats);
        conversation.sentMessageCount = inputLength;

        if (conversation.isPrimary && state.hadError) {
          manager.clearPrimary();
        }
      },
    }));
  },
} satisfies Provider;
