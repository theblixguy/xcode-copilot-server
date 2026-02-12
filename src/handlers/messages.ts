import type { FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "../context.js";
import {
  AnthropicMessagesRequestSchema,
  extractAnthropicSystem,
} from "../schemas/anthropic.js";
import { formatAnthropicPrompt } from "../utils/anthropic-prompt.js";
import { resolveModel } from "../utils/model-resolver.js";
import { createSessionConfig } from "./session-config.js";
import type { ConversationManager } from "../conversation-manager.js";
import { resolveToolResults } from "./messages/tool-result-handler.js";
import { handleAnthropicStreaming, startReply } from "./messages/streaming.js";
import { sendAnthropicError as sendError } from "./errors.js";

export function createMessagesHandler(
  { service, logger, config, port }: AppContext,
  manager: ConversationManager,
) {
  return async function handleMessages(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parseResult = AnthropicMessagesRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      sendError(
        reply,
        400,
        "invalid_request_error",
        firstIssue?.message ?? "Invalid request body",
      );
      return;
    }
    const req = parseResult.data;

    // --- Continuation routing ---
    const existingConv = manager.findByContinuation(req.messages);

    if (existingConv) {
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
      return;
    }

    // --- New request or reuse primary ---
    const { conversation, isReuse } = manager.findForNewRequest();
    const state = conversation.state;
    state.markSessionActive();

    logger.info(
      isReuse
        ? `Reusing primary conversation ${conversation.id}`
        : `New conversation ${conversation.id}`,
    );

    // SDK doesn't support switching models mid-session (github/copilot-sdk#409)
    if (isReuse && conversation.model && conversation.model !== req.model) {
      logger.warn(
        `Model mismatch: session uses "${conversation.model}" but request sent "${req.model}" (SDK does not support mid-session model switching)`,
      );
    }

    const tools = req.tools;
    const hasTools = !!tools?.length;
    const hasBridge = hasTools && config.toolBridge;

    if (tools?.length) {
      state.cacheTools(tools);
    }

    let prompt: string;
    try {
      prompt = formatAnthropicPrompt(req.messages.slice(conversation.sentMessageCount), config.excludedFilePatterns);
    } catch (err) {
      sendError(
        reply,
        400,
        "invalid_request_error",
        err instanceof Error ? err.message : String(err),
      );
      if (isReuse) {
        state.markSessionInactive();
      } else {
        manager.remove(conversation.id);
      }
      return;
    }

    logger.debug(`Prompt (${isReuse ? "incremental" : "full"}): ${String(prompt.length)} chars`);

    if (!isReuse) {
      const systemMessage = extractAnthropicSystem(req.system);

      logger.debug(`System message length: ${String(systemMessage?.length ?? 0)} chars`);
      logger.debug(`Tools in request: ${tools ? String(tools.length) : "0"}`);
      if (tools) {
        logger.debug(`Tool names: ${tools.map((t) => t.name).join(", ")}`);
      }

      let copilotModel = req.model;
      let supportsReasoningEffort = false;
      try {
        const models = await service.listModels();
        const resolved = resolveModel(req.model, models, logger);
        if (!resolved) {
          sendError(
            reply,
            400,
            "invalid_request_error",
            `Model "${req.model}" is not available. Available models: ${models.map((m) => m.id).join(", ")}`,
          );
          manager.remove(conversation.id);
          return;
        }
        copilotModel = resolved;

        if (config.reasoningEffort) {
          const modelInfo = models.find((m) => m.id === copilotModel);
          supportsReasoningEffort =
            modelInfo?.capabilities.supports.reasoningEffort ?? false;
          if (!supportsReasoningEffort) {
            logger.debug(
              `Model "${copilotModel}" does not support reasoning effort, ignoring config`,
            );
          }
        }
      } catch (err) {
        logger.warn("Failed to list models, passing model through as-is:", err);
      }

      conversation.model = copilotModel;

      if (hasBridge) {
        logger.info("Tool bridge active (in-process MCP)");
      }

      const sessionConfig = createSessionConfig({
        model: copilotModel,
        systemMessage,
        logger,
        config,
        supportsReasoningEffort,
        cwd: service.cwd,
        hasToolBridge: hasBridge,
        port,
        conversationId: conversation.id,
      });

      try {
        conversation.session = await service.createSession(sessionConfig);
      } catch (err) {
        logger.error("Creating session failed:", err);
        sendError(reply, 500, "api_error", "Failed to create session");
        manager.remove(conversation.id);
        return;
      }
    }

    if (!conversation.session) {
      logger.error("Primary conversation has no session, clearing");
      manager.clearPrimary();
      sendError(reply, 500, "api_error", "Session lost, please retry");
      return;
    }

    state.setReply(reply);

    try {
      logger.info(`Streaming response for conversation ${conversation.id}`);
      await handleAnthropicStreaming(state, conversation.session, prompt, req.model, logger, hasBridge);
      conversation.sentMessageCount = req.messages.length;

      if (conversation.isPrimary && state.hadError) {
        manager.clearPrimary();
      }
    } catch (err) {
      logger.error("Request failed:", err);
      if (conversation.isPrimary) {
        manager.clearPrimary();
      }
      if (!reply.sent) {
        sendError(
          reply,
          500,
          "api_error",
          err instanceof Error ? err.message : "Internal error",
        );
      }
    }
  };
}
