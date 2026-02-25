import type { Provider } from "../types.js";
import { registerToolBridge } from "../../tool-bridge/index.js";
import {
  createMessagesHandler,
  createCountTokensHandler,
} from "copilot-sdk-proxy";
import type { Conversation } from "../../conversation-manager.js";
import { resolveToolResults } from "./tool-results.js";
import { handleAnthropicStreaming, startReply } from "./streaming.js";
import { createSessionConfig } from "../shared/session-config.js";
import { filterExcludedFiles } from "../shared/prompt-utils.js";

export const claudeProvider = {
  name: "Claude",
  routes: ["POST /v1/messages", "POST /v1/messages/count_tokens"],

  register(app, ctx) {
    app.addHook("onRequest", (request, reply, done) => {
      // MCP routes come from the SDK, not Xcode, so they
      // won't have the claude-cli/ user-agent
      if (request.url.startsWith("/mcp/")) {
        done();
        return;
      }
      const ua = request.headers["user-agent"] ?? "";
      if (!ua.startsWith("claude-cli/")) {
        ctx.logger.warn(`Rejected request from unexpected user-agent: ${ua}`);
        void reply.code(403).type("application/json").send('{"error":"Forbidden"}\n');
        return;
      }
      done();
    });

    const manager = registerToolBridge(app, ctx.logger);
    const { logger, config, port, stats } = ctx;

    app.post("/v1/messages", createMessagesHandler(ctx, manager, {
      beforeHandler: async (req, reply) => {
        const existingConv = manager.findByContinuation(req.messages);
        if (!existingConv) return false;

        const state = existingConv.state;
        logger.info(`Continuation for conversation ${existingConv.id} (hasPending=${String(state.hasPending)}, sessionActive=${String(state.sessionActive)})`);
        state.setReply(reply);
        startReply(reply, req.model);

        // TODO: the continuation doesn't own the session so we can't abort it
        // here. The original streaming handler will let it run to idle harmlessly
        // because it guards against null replies, but ideally we'd abort it too.
        reply.raw.on("close", () => {
          if (state.currentReply === reply) {
            logger.info("Client disconnected during continuation");
            state.cleanup();
            state.notifyStreamingDone();
          }
        });

        resolveToolResults(req.messages, state, logger);
        await state.waitForStreamingDone();
        existingConv.sentMessageCount = req.messages.length;
        return true;
      },

      onConversationReady: (conversation, req) => {
        const { state } = conversation as Conversation;
        const tools = req.tools;
        if (tools?.length) {
          state.cacheTools(tools);
        }
      },

      transformPrompt: (prompt) =>
        filterExcludedFiles(prompt, config.excludedFilePatterns),

      createSessionConfig: (baseOptions, conversation, req) => {
        const tools = req.tools;
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

      handleStreaming: async ({ conversation, session, prompt, model, reply, req }) => {
        const { state } = conversation as Conversation;
        const hasBridge = !!req.tools?.length && config.toolBridge;
        state.setReply(reply);

        logger.info(`Streaming response for conversation ${conversation.id}`);
        await handleAnthropicStreaming(state, session, prompt, model, logger, hasBridge, stats);
        conversation.sentMessageCount = req.messages.length;

        if (conversation.isPrimary && state.hadError) {
          manager.clearPrimary();
        }
      },
    }));

    app.post("/v1/messages/count_tokens", createCountTokensHandler(ctx));
  },
} satisfies Provider;
