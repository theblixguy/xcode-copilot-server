import { describe, it, expect } from "vitest";
import { ChatCompletionRequestSchema, currentTimestamp } from "../src/providers/openai/schemas.js";

describe("ChatCompletionRequestSchema", () => {
  const validRequest = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello" }],
  };

  it("accepts a valid minimal request", () => {
    const result = ChatCompletionRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("rejects missing model", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty model string", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty messages array", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "gpt-4",
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing messages", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "gpt-4",
    });
    expect(result.success).toBe(false);
  });

  it("accepts array content format in messages", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts null content", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "gpt-4",
      messages: [{ role: "assistant", content: null }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      ...validRequest,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      user: "test-user",
    });
    expect(result.success).toBe(true);
  });

  it("accepts tools array", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      ...validRequest,
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the weather",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts messages with tool_calls", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "gpt-4",
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "search", arguments: "{}" },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("currentTimestamp", () => {
  it("returns a unix timestamp close to now", () => {
    const ts = currentTimestamp();
    const now = Math.floor(Date.now() / 1000);
    expect(ts).toBeTypeOf("number");
    expect(Math.abs(ts - now)).toBeLessThanOrEqual(1);
  });
});
