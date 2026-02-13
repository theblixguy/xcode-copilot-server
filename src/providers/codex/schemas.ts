import { randomUUID } from "node:crypto";
import { z } from "zod";

const ResponsesInputMessageSchema = z.object({
  type: z.literal("message").optional(),
  role: z.enum(["user", "assistant", "system", "developer"]),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
});

const FunctionCallInputSchema = z.object({
  type: z.literal("function_call"),
  id: z.string().optional(),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
});

const FunctionCallOutputInputSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string(),
  output: z.string(),
});

const InputItemSchema = z.union([
  ResponsesInputMessageSchema,
  FunctionCallInputSchema,
  FunctionCallOutputInputSchema,
]);

export type InputItem = z.infer<typeof InputItemSchema>;
export type InputMessage = z.infer<typeof ResponsesInputMessageSchema>;
export type FunctionCallInput = z.infer<typeof FunctionCallInputSchema>;
export type FunctionCallOutputInput = z.infer<typeof FunctionCallOutputInputSchema>;

/** Accept any tool shape in the request; we only process function tools. */
const RawToolSchema = z.record(z.string(), z.unknown());

const FunctionToolSchema = z.object({
  type: z.literal("function"),
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
});

export type ResponsesTool = z.infer<typeof FunctionToolSchema>;

/** Narrow to function tools only (ignore web_search, code_interpreter, etc.) */
export function filterFunctionTools(tools: Record<string, unknown>[]): ResponsesTool[] {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => FunctionToolSchema.parse(t));
}

export const ResponsesRequestSchema = z.object({
  model: z.string().min(1, "Model is required"),
  input: z.union([z.string(), z.array(InputItemSchema)]),
  instructions: z.string().optional(),
  tools: z.array(RawToolSchema).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  previous_response_id: z.string().optional(),
});

export type ResponsesRequest = z.infer<typeof ResponsesRequestSchema>;

export interface MessageContent {
  type: "output_text";
  text: string;
  annotations: unknown[];
}

export interface MessageOutputItem {
  type: "message";
  id: string;
  status: "in_progress" | "completed";
  role: "assistant";
  content: MessageContent[];
}

export interface FunctionCallOutputItem {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: "in_progress" | "completed";
}

export type OutputItem = MessageOutputItem | FunctionCallOutputItem;

export interface ResponseObject {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  output: OutputItem[];
  error?: { code: string; message: string } | null;
}

export function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function genId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
