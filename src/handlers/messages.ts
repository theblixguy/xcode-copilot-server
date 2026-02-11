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

function sendError(
  reply: FastifyReply,
  status: number,
  type: "invalid_request_error" | "api_error",
  message: string,
): void {
  reply.status(status).send({
    type: "error",
    error: { type, message },
  });
}

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
    // Check if this request continues an existing conversation (i.e. it
    // contains tool_result blocks that match a pending tool call).
    const existingConv = manager.findByContinuation(req.messages);

    if (existingConv) {
      const state = existingConv.state;
      logger.info(`Continuation for conversation ${existingConv.id} (hasPending=${String(state.hasPending)}, sessionActive=${String(state.sessionActive)})`);
      state.setReply(reply);
      startReply(reply, req.model);

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

    // --- New conversation ---
    const conversation = manager.create();
    const state = conversation.state;

    logger.info(`New conversation ${conversation.id}`);

    const systemMessage = extractAnthropicSystem(req.system);
    const tools = req.tools;
    const hasTools = !!tools?.length;

    logger.debug(`System message length: ${String(systemMessage?.length ?? 0)} chars`);
    logger.debug(`System message: ${systemMessage ?? "(none)"}`);
    logger.debug(`Tools in request: ${tools ? String(tools.length) : "0"}`);
    if (tools) {
      logger.debug(`Tool names: ${tools.map((t) => t.name).join(", ")}`);
    }

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
      manager.remove(conversation.id);
      return;
    }

    logger.debug(`Final prompt length: ${String(prompt.length)} chars`);
    logger.debug(`Final prompt: ${prompt}`);

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

    const toolBridgeServer = hasTools ? config.toolBridge : undefined;

    if (toolBridgeServer) {
      logger.info(`Tool bridge server: ${toolBridgeServer.command} ${toolBridgeServer.args.join(" ")}`);
    }

    const sessionConfig = createSessionConfig({
      model: copilotModel,
      systemMessage,
      logger,
      config,
      supportsReasoningEffort,
      cwd: service.cwd,
      toolBridgeServer,
      port,
      conversationId: conversation.id,
    });

    let session;
    try {
      session = await service.createSession(sessionConfig);
      conversation.session = session;
    } catch (err) {
      logger.error("Creating session failed:", err);
      sendError(reply, 500, "api_error", "Failed to create session");
      manager.remove(conversation.id);
      return;
    }

    state.setReply(reply);

    try {
      logger.info(`Streaming response for conversation ${conversation.id}`);
      await handleAnthropicStreaming(state, session, prompt, req.model, logger, hasTools);
      conversation.sentMessageCount = req.messages.length;
    } catch (err) {
      logger.error("Request failed:", err);
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
