import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "../../src/server.js";
import { codexProvider } from "../../src/providers/codex/provider.js";
import { Logger } from "../../src/logger.js";
import type { AppContext } from "../../src/context.js";
import type { ServerConfig } from "../../src/config.js";
import type { FastifyInstance } from "fastify";

const logger = new Logger("none");

const codexHeaders = {
  "user-agent": "Xcode/0.87.0 (Mac OS 26.2.0; arm64) unknown (Xcode; 26.3 (17C518))",
};

const baseConfig: ServerConfig = {
  toolBridge: false,
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 4 * 1024 * 1024,
  autoApprovePermissions: ["read", "mcp"],
};

function makeMockSession(events: Array<{ type: string; data: unknown }> = [{ type: "session.idle", data: {} }]) {
  return {
    on: (callback: (event: { type: string; data: unknown }) => void) => {
      for (const event of events) {
        queueMicrotask(() => { callback(event); });
      }
      return () => {};
    },
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Responses handler — model resolution failure", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockService = {
      cwd: "/test",
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4o",
          name: "gpt-4o",
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 200000 },
          },
        },
      ]),
      createSession: vi.fn().mockResolvedValue(makeMockSession()),
    };

    const ctx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config: baseConfig,
      port: 8080,
    };

    app = await createServer(ctx, codexProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 400 when model is not available", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: {
        model: "nonexistent-model",
        input: "Hello",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("nonexistent-model");
    expect(body.error.message).toContain("not available");
  });
});

describe("Responses handler — session creation failure", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockService = {
      cwd: "/test",
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4o",
          name: "gpt-4o",
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 200000 },
          },
        },
      ]),
      createSession: vi.fn().mockRejectedValue(new Error("SDK connection failed")),
    };

    const ctx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config: baseConfig,
      port: 8080,
    };

    app = await createServer(ctx, codexProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 500 when session creation throws", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: {
        model: "gpt-4o",
        input: "Hello",
      },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.type).toBe("api_error");
    expect(body.error.message).toContain("Failed to create session");
  });
});

describe("Responses handler — session error event", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockService = {
      cwd: "/test",
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4o",
          name: "gpt-4o",
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 200000 },
          },
        },
      ]),
      createSession: vi.fn().mockResolvedValue(
        makeMockSession([
          { type: "session.error", data: { message: "Rate limit exceeded" } },
        ]),
      ),
    };

    const ctx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config: baseConfig,
      port: 8080,
    };

    app = await createServer(ctx, codexProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  it("streams response.failed on session error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: {
        model: "gpt-4o",
        input: "Hello",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: response.created");
    expect(res.body).toContain("event: response.failed");
  });
});

describe("Responses handler — listModels failure falls through", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockService = {
      cwd: "/test",
      listModels: vi.fn().mockRejectedValue(new Error("Network error")),
      createSession: vi.fn().mockResolvedValue(makeMockSession()),
    };

    const ctx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config: baseConfig,
      port: 8080,
    };

    app = await createServer(ctx, codexProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  it("still streams a response when listModels fails", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: {
        model: "gpt-4o",
        input: "Hello",
      },
    });

    // listModels failure is non-fatal — model is passed through as-is
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: response.completed");
  });
});

describe("Responses handler — text deltas", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockService = {
      cwd: "/test",
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4o",
          name: "gpt-4o",
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 200000 },
          },
        },
      ]),
      createSession: vi.fn().mockResolvedValue(
        makeMockSession([
          { type: "assistant.message_delta", data: { deltaContent: "Hello " } },
          { type: "assistant.message_delta", data: { deltaContent: "world" } },
          { type: "assistant.message", data: { toolRequests: [] } },
          { type: "session.idle", data: {} },
        ]),
      ),
    };

    const ctx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config: baseConfig,
      port: 8080,
    };

    app = await createServer(ctx, codexProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  it("emits text delta and done events with accumulated text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: {
        model: "gpt-4o",
        input: "Hello",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: response.output_text.delta");
    expect(res.body).toContain("event: response.output_text.done");
    expect(res.body).toContain("Hello world");
    expect(res.body).toContain("event: response.completed");
  });
});
