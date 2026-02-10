import { z } from "zod";
import type { MessageContent } from "./types.js";

const ContentPartSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
});

const VALID_ROLES = ["system", "developer", "user", "assistant", "tool"] as const;

const MessageSchema = z.object({
  role: z.enum(VALID_ROLES).optional(),
  content: z
    .union([z.string(), z.array(ContentPartSchema), z.null()])
    .optional(),
  name: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        index: z.number().optional(),
        id: z.string().optional(),
        type: z.string().optional(),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
});

export const ChatCompletionRequestSchema = z.object({
  model: z.string().min(1, "Model is required"),
  messages: z.array(MessageSchema).min(1, "Messages are required"),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  n: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  max_tokens: z.number().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  tools: z
    .array(
      z.object({
        type: z.string(),
        function: z.object({
          name: z.string(),
          description: z.string().optional(),
          parameters: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
    )
    .optional(),
  tool_choice: z.unknown().optional(),
  user: z.string().optional(),
});

export function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

// Throws on malformed or unsupported content types so callers can surface
// a 400 error back to the client.
export function extractContentText(content: MessageContent | undefined): string {
  if (content == null) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    throw new Error(
      `invalid content type: expected string or array, got ${typeof content}`,
    );
  }

  let text = "";
  for (const part of content) {
    if (part.type !== "text") {
      throw new Error(`unsupported content type: ${part.type}`);
    }

    if (typeof part.text !== "string") {
      throw new Error("text content part missing required 'text' field");
    }

    text += part.text;
  }

  return text;
}
