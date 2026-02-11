import type { FastifyRequest, FastifyReply } from "fastify";
import type { CopilotSession } from "@github/copilot-sdk";
import type { AppContext } from "../context.js";
import { ChatCompletionRequestSchema, extractContentText } from "../schemas/openai.js";
import { formatPrompt } from "../utils/prompt.js";
import { createSessionConfig } from "./session-config.js";
import { handleStreaming } from "./completions/streaming.js";

function sendError(
  reply: FastifyReply,
  status: number,
  type: "invalid_request_error" | "api_error",
  message: string,
): void {
  reply.status(status).send({ error: { message, type } });
}

export function createCompletionsHandler({ service, logger, config }: AppContext) {
  let sentMessageCount = 0;

  return async function handleCompletions(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parseResult = ChatCompletionRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      sendError(reply, 400, "invalid_request_error", firstIssue?.message ?? "Invalid request body");
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
          sendError(reply, 400, "invalid_request_error", err instanceof Error ? err.message : String(err));
          return;
        }
      }
    }

    let prompt: string;
    try {
      prompt = formatPrompt(messages.slice(sentMessageCount), config.excludedFilePatterns);
    } catch (err) {
      sendError(reply, 400, "invalid_request_error", err instanceof Error ? err.message : String(err));
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
      session = await service.createSession(sessionConfig);
    } catch (err) {
      logger.error("Getting session failed:", err);
      sendError(reply, 500, "api_error", "Failed to create session");
      return;
    }

    try {
      logger.info("Streaming response");
      await handleStreaming(reply, session, prompt, req.model, logger);
      sentMessageCount = req.messages.length;
    } catch (err) {
      logger.error("Request failed:", err);
      if (!reply.sent) {
        sendError(reply, 500, "api_error", err instanceof Error ? err.message : "Internal error");
      }
    }
  };
}
