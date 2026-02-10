import type { FastifyRequest, FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import type { AppContext } from "../context.js";
import { ChatCompletionRequestSchema, extractContentText } from "../schemas.js";
import { formatPrompt } from "../utils/prompt.js";
import { createSessionConfig } from "./completions/session-config.js";
import { handleStreaming } from "./completions/streaming.js";

/** POST /v1/chat/completions */
export function createCompletionsHandler({ service, logger, config }: AppContext) {
  let sentMessageCount = 0;

  return async function handleCompletions(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parseResult = ChatCompletionRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      reply.status(400).send({
        error: {
          message: firstIssue?.message ?? "Invalid request body",
          type: "invalid_request_error",
        },
      });
      return;
    }
    const req = parseResult.data;
    const messages = req.messages;

    const systemParts: string[] = [];
    for (const msg of messages) {
      if (msg.role === "system" || msg.role === "developer") {
        try {
          systemParts.push(extractContentText(msg.content));
        } catch (err) {
          reply.status(400).send({
            error: {
              message: err instanceof Error ? err.message : String(err),
              type: "invalid_request_error",
            },
          });
          return;
        }
      }
    }

    let prompt: string;
    try {
      prompt = formatPrompt(messages.slice(sentMessageCount), config.excludedFilePatterns);
    } catch (err) {
      reply.status(400).send({
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: "invalid_request_error",
        },
      });
      return;
    }

    const systemMessage =
      systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    let supportsReasoningEffort = false;
    if (config.reasoningEffort) {
      try {
        const models = await service.listModels();
        const modelInfo = models.find((m) => m.id === req.model);
        supportsReasoningEffort =
          modelInfo?.capabilities.supports.reasoningEffort ?? false;
        if (!supportsReasoningEffort) {
          logger.debug(
            `Model "${req.model}" does not support reasoning effort, ignoring config`,
          );
        }
      } catch (err) {
        logger.warn("Failed to check model capabilities:", err);
      }
    }

    const sessionConfig = createSessionConfig({
      model: req.model,
      systemMessage,
      logger,
      config,
      supportsReasoningEffort,
      cwd: service.cwd,
    });

    let session: CopilotSession;
    try {
      session = await service.getSession(sessionConfig);
    } catch (err) {
      logger.error("Getting session failed:", err);
      reply.status(500).send({
        error: {
          message: "Failed to create session",
          type: "api_error",
        },
      });
      return;
    }

    try {
      logger.info("Streaming response");
      await handleStreaming(reply, session, prompt, req.model, logger);
      sentMessageCount = req.messages.length;
    } catch (err) {
      logger.error("Request failed:", err);
      if (!reply.sent) {
        reply.status(500).send({
          error: {
            message: err instanceof Error ? err.message : "Internal error",
            type: "api_error",
          },
        });
      }
    }
  };
}
