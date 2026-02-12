import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "../../src/server.js";
import { openaiProvider } from "../../src/providers/openai.js";
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
  autoApprovePermissions: true,
};

const xcodeHeaders = { "user-agent": "Xcode/24577 CFNetwork/3860.300.31 Darwin/25.2.0" };

function makePayload(model = "copilot-chat") {
  return {
    model,
    messages: [{ role: "user", content: "Hello" }],
  };
}

describe("OpenAI completions session reuse", () => {
  let app: FastifyInstance;
  let createSessionSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const createMockSession = () => ({
      on: (callback: (event: { type: string; data: unknown }) => void) => {
        queueMicrotask(() => {
          callback({ type: "session.idle", data: {} });
        });
        return () => {};
      },
      send: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    });

    createSessionSpy = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return createMockSession();
    });

    const mockService = {
      cwd: "/test",
      listModels: vi.fn().mockResolvedValue([]),
      createSession: createSessionSpy,
    };

    const ctx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config,
      port: 8080,
    };

    app = await createServer(ctx, openaiProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates separate sessions for concurrent requests", async () => {
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: xcodeHeaders,
        payload: makePayload(),
      }),
      app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: xcodeHeaders,
        payload: makePayload(),
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.body).toContain("chat.completion.chunk");
    expect(res2.body).toContain("chat.completion.chunk");

    expect(createSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("reuses primary session for a sequential follow-up", async () => {
    createSessionSpy.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: xcodeHeaders,
      payload: {
        model: "copilot-chat",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
          { role: "user", content: "What is 2+2?" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("chat.completion.chunk");
    expect(createSessionSpy).toHaveBeenCalledTimes(0);
  });
});
