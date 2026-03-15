import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { Logger } from "copilot-sdk-proxy";
import {
  registerToolBridge,
  resolveToolBridgeManager,
} from "../../src/tool-bridge/index.js";

const logger = new Logger("none");

describe("registerToolBridge", () => {
  it("returns a ConversationManager and registers MCP routes", async () => {
    const app = Fastify();
    const manager = registerToolBridge(app, logger);
    await app.ready();

    expect(manager).toBeDefined();
    expect(typeof manager.create).toBe("function");

    const resp = await app.inject({
      method: "POST",
      url: "/mcp/test-conv",
      payload: {},
    });
    expect(resp.statusCode).not.toBe(404);

    await app.close();
  });
});

describe("resolveToolBridgeManager", () => {
  it("returns existing manager when provided", async () => {
    const app = Fastify();
    const existing = registerToolBridge(app, logger);
    await app.ready();

    const resolved = resolveToolBridgeManager(app, existing, logger);
    expect(resolved).toBe(existing);

    await app.close();
  });

  it("creates a new manager when existing is undefined", async () => {
    const app = Fastify();
    const resolved = resolveToolBridgeManager(app, undefined, logger);
    await app.ready();

    expect(resolved).toBeDefined();
    expect(typeof resolved.create).toBe("function");

    await app.close();
  });
});
