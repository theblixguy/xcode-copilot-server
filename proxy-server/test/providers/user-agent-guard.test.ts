import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { addUserAgentGuard } from "../../src/providers/shared/user-agent-guard.js";
import { Logger } from "copilot-sdk-proxy";

const logger = new Logger("none");

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  addUserAgentGuard(app, "test-cli/", logger);
  app.get("/api/test", (_req, reply) => reply.send({ ok: true }));
  app.get("/mcp/conv-1", (_req, reply) => reply.send({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("addUserAgentGuard", () => {
  it("allows requests with matching user-agent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: { "user-agent": "test-cli/1.0" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("rejects requests with wrong user-agent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: { "user-agent": "curl/7.0" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects requests with no user-agent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("exempts /mcp/ routes from guard", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/mcp/conv-1",
      headers: { "user-agent": "sdk-internal" },
    });
    expect(res.statusCode).toBe(200);
  });
});
