import type { FastifyRequest, FastifyReply } from "fastify";
import { estimateTokenCount } from "tokenx";
import type { AppContext } from "../../context.js";
import {
  AnthropicMessagesRequestSchema,
  type AnthropicMessagesRequest,
} from "./schemas.js";
import { sendAnthropicError } from "../shared/errors.js";

// The token estimator needs a single string, so we pull all text out of
// the structured request.
function extractAllText(req: AnthropicMessagesRequest): string {
  const parts: string[] = [];

  if (req.system != null) {
    if (typeof req.system === "string") {
      parts.push(req.system);
    } else {
      for (const block of req.system) {
        parts.push(block.text);
      }
    }
  }

  for (const msg of req.messages) {
    if (typeof msg.content === "string") {
      parts.push(msg.content);
    } else {
      for (const block of msg.content) {
        switch (block.type) {
          case "text":
            parts.push(block.text);
            break;
          case "tool_use":
            parts.push(block.name);
            parts.push(JSON.stringify(block.input));
            break;
          case "tool_result":
            if (typeof block.content === "string") {
              parts.push(block.content);
            } else if (Array.isArray(block.content)) {
              for (const tb of block.content) {
                parts.push(tb.text);
              }
            }
            break;
          default:
            throw block satisfies never;
        }
      }
    }
  }

  if (req.tools) {
    for (const tool of req.tools) {
      parts.push(tool.name);
      if (tool.description) parts.push(tool.description);
      parts.push(JSON.stringify(tool.input_schema));
    }
  }

  return parts.join(" ");
}

export function createCountTokensHandler({ logger }: AppContext) {
  return function handleCountTokens(
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const parseResult = AnthropicMessagesRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      sendAnthropicError(reply, 400, "invalid_request_error", firstIssue?.message ?? "Invalid request body");
      return;
    }

    const allText = extractAllText(parseResult.data);
    const inputTokens = estimateTokenCount(allText);

    logger.debug(`Token count estimate: ${String(inputTokens)}`);
    void reply.send({ input_tokens: inputTokens });
  };
}
