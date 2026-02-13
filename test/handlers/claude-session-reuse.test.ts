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
  autoApprovePermissions: true,
};

const claudeCliHeaders = { "user-agent": "claude-cli/2.1.14 (external, sdk-cli)" };

function makePayload(model = "claude-sonnet-4-20250514") {
  return {
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
  };
}

describe("Concurrent request handling", () => {
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
      createSession: createSessionSpy,
    };

    const ctx: AppContext = {
      service: mockService as unknown as AppContext["service"],
      logger,
      config,
      port: 8080,
    };

    app = await createServer(ctx, claudeProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates separate sessions for concurrent requests", async () => {
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: claudeCliHeaders,
        payload: makePayload(),
      }),
      app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: claudeCliHeaders,
        payload: makePayload(),
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.body).toContain("event: message_start");
    expect(res2.body).toContain("event: message_start");

    expect(createSessionSpy).toHaveBeenCalledTimes(2);

    const config1 = createSessionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const config2 = createSessionSpy.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(config1).toBeDefined();
    expect(config2).toBeDefined();
  });

  it("does not misroute a new request as a continuation", async () => {
    createSessionSpy.mockClear();

    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: claudeCliHeaders,
        payload: makePayload(),
      }),
      app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: claudeCliHeaders,
        payload: makePayload(),
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    // The reuse path completes in microtask time so both serialize through
    // the primary, true concurrency is tested by the first test where the
    // 10ms createSession delay forces real overlap
    expect(createSessionSpy).toHaveBeenCalledTimes(0);
  });

  it("reuses primary session for a sequential follow-up request", async () => {
    createSessionSpy.mockClear();

    // Follow-up with more messages so the incremental prompt is non-empty
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: claudeCliHeaders,
      payload: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
          { role: "user", content: "What is 2+2?" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: message_start");
    expect(createSessionSpy).toHaveBeenCalledTimes(0);
  });
});
