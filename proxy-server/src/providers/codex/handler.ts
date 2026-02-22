import type { FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "../../context.js";
import { ResponsesRequestSchema, filterFunctionTools } from "./schemas.js";
import { genId } from "./schemas.js";
import {
  formatResponsesPrompt,
  extractInstructions,
  extractFunctionCallOutputs,
} from "./prompt.js";
import { resolveModel } from "../shared/model-resolver.js";
import { createSessionConfig } from "../shared/session-config.js";
import type { ConversationManager } from "../../conversation-manager.js";
import { resolveResponsesToolResults } from "./tool-results.js";
import { handleResponsesStreaming, startResponseStream } from "./streaming.js";
import { sendOpenAIError as sendError } from "../shared/errors.js";

export function createResponsesHandler(
  { service, logger, config, port, stats }: AppContext,
  manager: ConversationManager,
) {
  return async function handleResponses(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    stats.recordRequest();

    const parseResult = ResponsesRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      logger.debug(`Request validation failed: ${JSON.stringify(parseResult.error.issues)}`);
      logger.debug(`Raw body keys: ${JSON.stringify(Object.keys((request.body ?? {}) as Record<string, unknown>))}`);
      sendError(
        reply,
        400,
        "invalid_request_error",
        firstIssue?.message ?? "Invalid request body",
      );
      return;
    }
    const req = parseResult.data;

    const callOutputs = extractFunctionCallOutputs(req.input);
    logger.debug(`function_call_output items: ${String(callOutputs.length)}${callOutputs.length > 0 ? ` (call_ids: ${callOutputs.map((o) => o.call_id).join(", ")})` : ""}`);

    if (callOutputs.length > 0) {
      const existingConv = manager.findByContinuationIds(
        callOutputs.map((o) => o.call_id),
      );

      if (existingConv) {
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
        return;
      }
    }

    const { conversation, isReuse } = manager.findForNewRequest();
    const state = conversation.state;
    state.markSessionActive();

    logger.info(
      isReuse
        ? `Reusing primary conversation ${conversation.id}`
        : `New conversation ${conversation.id}`,
    );

    if (isReuse && conversation.model && conversation.model !== req.model) {
      logger.warn(
        `Model mismatch: session uses "${conversation.model}" but request sent "${req.model}" (SDK does not support mid-session model switching)`,
      );
    }

    const tools = req.tools ? filterFunctionTools(req.tools) : undefined;
    const hasTools = !!tools?.length;
    const hasBridge = hasTools && config.toolBridge;

    // Responses API tools use `parameters`, bridge uses `input_schema`
    if (tools?.length) {
      const bridgeTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters ?? {},
      }));
      state.cacheTools(bridgeTools);
    }

    const inputLength = Array.isArray(req.input) ? req.input.length : 1;
    const slicedInput = isReuse && Array.isArray(req.input)
      ? req.input.slice(conversation.sentMessageCount)
      : req.input;

    let prompt: string;
    try {
      prompt = formatResponsesPrompt(slicedInput, config.excludedFilePatterns);
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
      const systemMessage = req.instructions ?? extractInstructions(req.input);

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
        stats.recordSession();
      } catch (err) {
        logger.error("Creating session failed:", err);
        stats.recordError();
        sendError(reply, 500, "api_error", "Failed to create session");
        manager.remove(conversation.id);
        return;
      }
    }

    if (!conversation.session) {
      logger.error("Primary conversation has no session, clearing");
      manager.clearPrimary();
      stats.recordError();
      sendError(reply, 500, "api_error", "Session lost, please retry");
      return;
    }

    state.setReply(reply);

    const responseId = genId("resp");

    try {
      logger.info(`Streaming response for conversation ${conversation.id}`);
      await handleResponsesStreaming(state, conversation.session, prompt, req.model, logger, hasBridge, responseId, stats);
      conversation.sentMessageCount = inputLength;

      if (conversation.isPrimary && state.hadError) {
        manager.clearPrimary();
      }
    } catch (err) {
      logger.error("Request failed:", err);
      stats.recordError();
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
