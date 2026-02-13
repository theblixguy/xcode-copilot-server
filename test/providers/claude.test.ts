import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "../../src/server.js";
import { claudeProvider } from "../../src/providers/claude/provider.js";
import { Logger } from "../../src/logger.js";
import type { AppContext } from "../../src/context.js";
import type { ServerConfig } from "../../src/config.js";
import type { FastifyInstance } from "fastify";

const logger = new Logger("none");

const config: ServerConfig = {
  toolBridge: false,
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 4 * 1024 * 1024,
  autoApprovePermissions: ["read", "mcp"],
};

const ctx: AppContext = {
  service: {} as AppContext["service"],
  logger,
  config,
  port: 8080,
};

const claudeCliHeaders = { "user-agent": "claude-cli/2.1.14 (external, sdk-cli)" };

let app: FastifyInstance;

beforeAll(async () => {
  app = await createServer(ctx, claudeProvider);
});

afterAll(async () => {
  await app.close();
});

describe("Anthropic provider — user-agent check", () => {
  it("allows claude-cli/ user-agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: claudeCliHeaders,
      payload: { model: "claude-sonnet-4-20250514", max_tokens: 1024, messages: [] },
    });
    // 400 from validation (empty messages), not 403
    expect(res.statusCode).toBe(400);
  });

  it("rejects requests with non-allowed user-agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "user-agent": "curl/8.0" },
      payload: { model: "claude-sonnet-4-20250514", max_tokens: 1024, messages: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects requests with no user-agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {},
      payload: { model: "claude-sonnet-4-20250514", max_tokens: 1024, messages: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("skips UA check for /mcp/ routes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv",
      headers: {},
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
    // Should not be 403 since no UA is required for MCP routes
    expect(res.statusCode).not.toBe(403);
  });
});

describe("Anthropic provider — /v1/messages validation", () => {
  it("returns 400 for missing model", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: claudeCliHeaders,
      payload: { max_tokens: 1024, messages: [{ role: "user", content: "Hello" }] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns 400 for empty messages", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: claudeCliHeaders,
      payload: { model: "claude-sonnet-4-20250514", max_tokens: 1024, messages: [] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
  });
});

describe("Anthropic provider — /v1/messages/count_tokens", () => {
  it("returns 400 for invalid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages/count_tokens",
      headers: claudeCliHeaders,
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns token count for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages/count_tokens",
      headers: claudeCliHeaders,
      payload: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Hello, Claude" }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("input_tokens");
    expect(typeof body.input_tokens).toBe("number");
    expect(body.input_tokens).toBeGreaterThan(0);
  });

  it("includes tool definitions in token count", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages/count_tokens",
      headers: claudeCliHeaders,
      payload: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            name: "get_weather",
            description: "Get the current weather in a given location",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const withTools = res.json().input_tokens;

    const resNoTools = await app.inject({
      method: "POST",
      url: "/v1/messages/count_tokens",
      headers: claudeCliHeaders,
      payload: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
      },
    });
    const withoutTools = resNoTools.json().input_tokens;

    expect(withTools).toBeGreaterThan(withoutTools);
  });
});

describe("Anthropic provider — route isolation", () => {
  it("does NOT have OpenAI routes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: claudeCliHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it("does NOT have /v1/chat/completions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: claudeCliHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Anthropic provider — /v1/messages happy path", () => {
  let streamApp: FastifyInstance;

  beforeAll(async () => {
    const mockSession = {
      on: (callback: (event: { type: string; data: unknown }) => void) => {
        queueMicrotask(() => {
          callback({ type: "session.idle", data: {} });
        });
        return () => {};
      },
      send: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };

    const mockService = {
      cwd: "/test",
      listModels: vi.fn().mockResolvedValue([
        {
          id: "claude-sonnet-4-20250514",
          name: "claude-sonnet-4-20250514",
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 200000 },
          },
        },
      ]),
      createSession: vi.fn().mockResolvedValue(mockSession),
    };

    const streamCtx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config,
      port: 8080,
    };

    streamApp = await createServer(streamCtx, claudeProvider);
  });

  afterAll(async () => {
    await streamApp.close();
  });

  it("streams SSE response for valid request", async () => {
    const res = await streamApp.inject({
      method: "POST",
      url: "/v1/messages",
      headers: claudeCliHeaders,
      payload: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");

    const body = res.body;
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: content_block_start");
    expect(body).toContain("event: content_block_stop");
    expect(body).toContain("event: message_delta");
    expect(body).toContain("event: message_stop");
  });
});
