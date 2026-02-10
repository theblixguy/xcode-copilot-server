import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../../src/server.js";
import { openaiProvider } from "../../src/providers/openai.js";
import { Logger } from "../../src/logger.js";
import type { AppContext } from "../../src/context.js";
import type { ServerConfig } from "../../src/config.js";
import type { FastifyInstance } from "fastify";

const logger = new Logger("none");

const config: ServerConfig = {
  passthroughMcpServer: null,
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

let app: FastifyInstance;

beforeAll(async () => {
  app = await createServer(ctx, openaiProvider);
});

afterAll(async () => {
  await app.close();
});

describe("OpenAI provider — user-agent check", () => {
  it("allows requests with Xcode user-agent past the hook", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { "user-agent": "Xcode/24577 CFNetwork/3860.300.31 Darwin/25.2.0" },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects requests without user-agent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Forbidden" });
  });

  it("rejects requests with non-Xcode user-agent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { "user-agent": "curl/8.0" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Forbidden" });
  });
});

describe("OpenAI provider — route isolation", () => {
  it("does NOT have Anthropic routes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "user-agent": "Xcode/24577" },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

const xcodeHeaders = { "user-agent": "Xcode/24577 CFNetwork/3860.300.31 Darwin/25.2.0" };

describe("OpenAI provider — /v1/chat/completions validation", () => {
  it("returns 400 for missing model", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: xcodeHeaders,
      payload: { messages: [{ role: "user", content: "Hello" }] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns 400 for empty messages array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: xcodeHeaders,
      payload: { model: "gpt-4", messages: [] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns 400 for missing messages", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: xcodeHeaders,
      payload: { model: "gpt-4" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });
});
