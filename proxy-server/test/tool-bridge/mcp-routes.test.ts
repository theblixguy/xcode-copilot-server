import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerRoutes } from "../../src/tool-bridge/routes.js";
import { ConversationManager } from "../../src/conversation-manager.js";
import { Logger } from "copilot-sdk-proxy";

const logger = new Logger("none");

let app: FastifyInstance;
let manager: ConversationManager;

beforeAll(async () => {
  app = Fastify();
  manager = new ConversationManager(logger);
  registerRoutes(app, manager, logger);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function jsonRpc(method: string, id?: number | string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", method, ...(id !== undefined && { id }), ...(params && { params }) } as Record<string, unknown>;
}

describe("POST /mcp/:convId — initialize", () => {
  it("returns protocol version and server info", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv",
      payload: jsonRpc("initialize", 1),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.serverInfo.name).toBe("xcode-bridge");
    expect(body.result.capabilities).toEqual({ tools: {} });
  });
});

describe("POST /mcp/:convId — notifications", () => {
  it("returns 202 for notifications (no id)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv",
      payload: jsonRpc("notifications/initialized"),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /mcp/:convId — tools/list", () => {
  it("returns cached tools for existing conversation", async () => {
    const conv = manager.create();
    conv.state.cacheTools([
      { name: "mcp__xcode-tools__XcodeRead", description: "Read a file", input_schema: { type: "object", properties: {} } },
      { name: "mcp__xcode-tools__XcodeWrite", description: "Write a file", input_schema: { type: "object", properties: {} } },
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/mcp/${conv.id}`,
      payload: jsonRpc("tools/list", 2),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(2);
    expect(body.result.tools).toHaveLength(2);
    expect(body.result.tools[0].name).toBe("XcodeRead");
    expect(body.result.tools[0].inputSchema).toEqual({ type: "object", properties: {} });
    expect(body.result.tools[1].name).toBe("XcodeWrite");
  });

  it("strips mcp__{server}__ prefix from tool names", async () => {
    const conv = manager.create();
    conv.state.cacheTools([
      { name: "mcp__xcode-tools__XcodeRead", description: "Read", input_schema: { type: "object", properties: {} } },
      { name: "mcp__xcode-tools__XcodeWrite", description: "Write", input_schema: { type: "object", properties: {} } },
      { name: "Glob", description: "Glob", input_schema: { type: "object", properties: {} } },
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/mcp/${conv.id}`,
      payload: jsonRpc("tools/list", 20),
    });
    const body = res.json();
    expect(body.result.tools).toHaveLength(3);
    expect(body.result.tools[0].name).toBe("XcodeRead");
    expect(body.result.tools[1].name).toBe("XcodeWrite");
    expect(body.result.tools[2].name).toBe("Glob");
  });

  it("returns error for unknown conversation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/nonexistent",
      payload: jsonRpc("tools/list", 3),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(3);
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toContain("not found");
  });
});

describe("POST /mcp/:convId — tools/call", () => {
  it("calls registerMCPRequest and returns result", async () => {
    const conv = manager.create();
    conv.state.cacheTools([
      { name: "Read", description: "Read a file", input_schema: { type: "object", properties: {} } },
    ]);

    vi.spyOn(conv.state, "registerMCPRequest").mockImplementation(
      (_name, resolve) => {
        resolve("file contents here");
      },
    );

    const res = await app.inject({
      method: "POST",
      url: `/mcp/${conv.id}`,
      payload: jsonRpc("tools/call", 4, { name: "Read", arguments: { path: "/test.txt" } }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(4);
    expect(body.result.content).toEqual([{ type: "text", text: "file contents here" }]);
  });

  it("returns error when registerMCPRequest rejects", async () => {
    const conv = manager.create();
    conv.state.cacheTools([
      { name: "Read", description: "Read a file", input_schema: { type: "object", properties: {} } },
    ]);

    vi.spyOn(conv.state, "registerMCPRequest").mockImplementation(
      (_name, _resolve, reject) => {
        reject(new Error("Tool timed out"));
      },
    );

    const res = await app.inject({
      method: "POST",
      url: `/mcp/${conv.id}`,
      payload: jsonRpc("tools/call", 5, { name: "Read", arguments: {} }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(5);
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toBe("Tool timed out");
  });

  it("returns error for missing tool name", async () => {
    const conv = manager.create();
    const res = await app.inject({
      method: "POST",
      url: `/mcp/${conv.id}`,
      payload: jsonRpc("tools/call", 6, { arguments: {} }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(6);
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("Missing tool name");
  });

  it("returns error for unknown conversation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/nonexistent",
      payload: jsonRpc("tools/call", 7, { name: "Read" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(7);
    expect(body.error.code).toBe(-32603);
  });

  it("resolves hallucinated tool names", async () => {
    const conv = manager.create();
    conv.state.cacheTools([
      { name: "mcp__xcode-tools__XcodeRead", description: "Read", input_schema: { type: "object", properties: {} } },
    ]);

    vi.spyOn(conv.state, "registerMCPRequest").mockImplementation(
      (name, resolve) => {
        resolve(`called: ${name}`);
      },
    );

    const res = await app.inject({
      method: "POST",
      url: `/mcp/${conv.id}`,
      payload: jsonRpc("tools/call", 8, { name: "XcodeRead", arguments: {} }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.content[0].text).toBe("called: mcp__xcode-tools__XcodeRead");
  });
});

describe("GET /mcp/:convId — SSE stream", () => {
  it("is registered as a route", () => {
    // The SSE endpoint keeps the connection open indefinitely, so we can't
    // use inject (it waits for the response to end). Instead, verify the
    // route is registered in the routing tree.
    const routes = app.printRoutes();
    expect(routes).toContain(":convId (GET");
  });
});

describe("POST /mcp/:convId — unknown method", () => {
  it("returns method-not-found error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv",
      payload: jsonRpc("unknown/method", 99),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(99);
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("Method not found");
  });
});
