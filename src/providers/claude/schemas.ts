import { z } from "zod";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | TextBlock[] | undefined;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string | undefined;
  input_schema: Record<string, unknown>;
}

export interface MessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: [];
    model: string;
    stop_reason: null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export type TextContentBlock = { type: "text"; text: "" };
export type ToolUseContentBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: TextContentBlock | ToolUseContentBlock;
}

export type TextDelta = { type: "text_delta"; text: string };
export type InputJsonDelta = { type: "input_json_delta"; partial_json: string };

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: TextDelta | InputJsonDelta;
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason: string; stop_sequence: null };
  usage: { output_tokens: number };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export type AnthropicSSEEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

export interface AnthropicErrorResponse {
  type: "error";
  error: {
    type: "invalid_request_error" | "api_error";
    message: string;
  };
}

export interface CountTokensResponse {
  input_tokens: number;
}

const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

const ToolResultContentSchema = z.union([
  z.string(),
  z.array(TextBlockSchema),
]);

const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: ToolResultContentSchema.optional(),
});

const ContentBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
]);

const AnthropicMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
});

const AnthropicToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()),
});

export const AnthropicMessagesRequestSchema = z.object({
  model: z.string().min(1, "Model is required"),
  max_tokens: z.number().int().positive("max_tokens must be positive"),
  system: z.union([z.string(), z.array(TextBlockSchema)]).optional(),
  messages: z.array(AnthropicMessageSchema).min(1, "Messages are required"),
  tools: z.array(AnthropicToolDefinitionSchema).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  stop_sequences: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;

// The Anthropic API accepts system as a string or an array of text blocks,
// so we flatten it into a single string for the Copilot SDK.
export function extractAnthropicSystem(
  system: string | TextBlock[] | undefined,
): string | undefined {
  if (system == null) return undefined;
  if (typeof system === "string") return system;
  const text = system.map((b) => b.text).join("\n\n");
  return text || undefined;
}
