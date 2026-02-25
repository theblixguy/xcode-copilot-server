import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, Logger, Stats } from "copilot-sdk-proxy";
import { codexProvider } from "../../src/providers/codex/provider.js";
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
  stats: new Stats(),
};

const codexHeaders = { "user-agent": "Xcode/0.87.0 (Mac OS 26.2.0; arm64) unknown (Xcode; 26.3 (17C518))" };

let app: FastifyInstance;

beforeAll(async () => {
  app = await createServer(ctx, codexProvider);
});

afterAll(async () => {
  await app.close();
});

describe("Codex provider — user-agent check", () => {
  it("allows Xcode/ user-agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: { model: "gpt-4o", input: "Hello" },
    });
    // should get past UA check (500 because no real service, not 403)
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects requests with non-allowed user-agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { "user-agent": "curl/8.0" },
      payload: { model: "gpt-4o", input: "Hello" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects requests with no user-agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: {},
      payload: { model: "gpt-4o", input: "Hello" },
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
    expect(res.statusCode).not.toBe(403);
  });
});

describe("Codex provider — /v1/responses validation", () => {
  it("returns 400 for missing model", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: { input: "Hello" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns 400 for empty model", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: { model: "", input: "Hello" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Codex provider — route isolation", () => {
  it("does NOT have /v1/models", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: codexHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it("does NOT have /v1/chat/completions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: codexHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("does NOT have /v1/messages", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: codexHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Codex provider — /v1/responses happy path", () => {
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
          id: "gpt-4o",
          name: "gpt-4o",
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
      stats: new Stats(),
    };

    streamApp = await createServer(streamCtx, codexProvider);
  });

  afterAll(async () => {
    await streamApp.close();
  });

  it("streams SSE response for valid request", async () => {
    const res = await streamApp.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: {
        model: "gpt-4o",
        input: "Hello",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");

    const body = res.body;
    expect(body).toContain("event: response.created");
    expect(body).toContain("event: response.in_progress");
    expect(body).toContain("event: response.output_item.added");
    expect(body).toContain("event: response.output_item.done");
    expect(body).toContain("event: response.completed");
  });

  it("accepts array input with messages", async () => {
    const res = await streamApp.inject({
      method: "POST",
      url: "/v1/responses",
      headers: codexHeaders,
      payload: {
        model: "gpt-4o",
        input: [
          { role: "user", content: "Hello" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
  });
});
