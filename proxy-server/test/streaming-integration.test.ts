import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SessionEvent, SessionEventHandler, CopilotSession } from "@github/copilot-sdk";
import { createServer, Logger, Stats } from "copilot-sdk-proxy";
import { claudeProvider } from "../src/providers/claude/provider.js";
import { codexProvider } from "../src/providers/codex/provider.js";
import { openaiProvider } from "../src/providers/openai/provider.js";
import type { AppContext } from "../src/context.js";
import { BYTES_PER_MIB, type ServerConfig } from "../src/config-schema.js";
import { BRIDGE_TOOL_PREFIX } from "../src/bridge-constants.js";
import type { Provider } from "../src/providers/types.js";

const BASE_EVENT = { id: "e1", timestamp: new Date().toISOString(), parentId: null };

type EventSequence = (emit: (type: string, data: Record<string, unknown>) => void) => void;

function createMockSession(sequence: EventSequence): CopilotSession {
  let handler: SessionEventHandler | null = null;

  function emit(type: string, data: Record<string, unknown>): void {
    handler?.({ ...BASE_EVENT, type, data } as unknown as SessionEvent);
  }

  return {
    on(h: SessionEventHandler) {
      handler = h;
      return () => { handler = null; };
    },
    abort: () => Promise.resolve(),
    setModel: () => Promise.resolve(),
    send() {
      sequence(emit);
      return Promise.resolve();
    },
  } as unknown as CopilotSession;
}

function standardSequence(opts: {
  deltas: string[];
  reasoning?: string[];
  toolCall?: { id: string; name: string; args: Record<string, unknown> };
  compaction?: boolean;
}): EventSequence {
  return (emit) => {
    if (opts.reasoning) {
      for (const text of opts.reasoning) {
        emit("assistant.reasoning_delta", { reasoningId: "r1", deltaContent: text });
      }
      emit("assistant.reasoning", { reasoningId: "r1", content: opts.reasoning.join("") });
    }

    if (opts.compaction) {
      emit("session.compaction_start", {});
      emit("session.compaction_complete", {
        success: true,
        preCompactionTokens: 1000,
        postCompactionTokens: 400,
      });
    }

    if (opts.toolCall) {
      emit("tool.execution_start", {
        toolCallId: opts.toolCall.id,
        toolName: opts.toolCall.name,
        arguments: opts.toolCall.args,
      });
      emit("tool.execution_complete", {
        toolCallId: opts.toolCall.id,
        success: true,
        result: { content: "tool result" },
      });
    }

    for (const text of opts.deltas) {
      emit("assistant.message_delta", { messageId: "m1", deltaContent: text });
    }
    emit("assistant.message", {
      messageId: "m1",
      content: opts.deltas.join(""),
      toolRequests: [],
    });

    emit("assistant.usage", { inputTokens: 10, outputTokens: 5, model: "test-model" });
    emit("session.idle", {});
  };
}

function toolRequestSequence(opts: {
  deltas: string[];
  toolRequests: { toolCallId: string; name: string; arguments?: unknown }[];
}): EventSequence {
  return (emit) => {
    for (const text of opts.deltas) {
      emit("assistant.message_delta", { messageId: "m1", deltaContent: text });
    }
    emit("assistant.message", {
      messageId: "m1",
      content: opts.deltas.join(""),
      toolRequests: opts.toolRequests,
    });
    // No session.idle: the session stays active waiting for tool results
  };
}

function parseSSELines(body: string): unknown[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as unknown);
}

const config: ServerConfig = {
  toolBridge: false,
  toolBridgeTimeoutMs: 0,
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 4 * BYTES_PER_MIB,
  requestTimeoutMs: 0,
  autoApprovePermissions: ["read", "mcp"],
};

const toolBridgeConfig: ServerConfig = {
  ...config,
  toolBridge: true,
};

function createCtx(sequence: EventSequence, overrideConfig?: ServerConfig): AppContext {
  return {
    service: {
      cwd: process.cwd(),
      createSession: () => Promise.resolve(createMockSession(sequence)),
      listModels: () => Promise.resolve([
        { id: "test-model", capabilities: { supports: { reasoningEffort: false } } },
      ]),
      ping: () => Promise.resolve({ message: "ok", timestamp: Date.now() }),
    } as unknown as AppContext["service"],
    logger: new Logger("none"),
    config: overrideConfig ?? config,
    port: 8080,
    stats: new Stats(),
  };
}

async function createApp(ctx: AppContext, provider: Provider): Promise<FastifyInstance> {
  return createServer(ctx, provider);
}

const claudeHeaders = { "user-agent": "claude-cli/1.0" };
const codexHeaders = { "user-agent": "Xcode/24577 CFNetwork/3860.300.31 Darwin/25.2.0" };
const xcodeHeaders = { "user-agent": "Xcode/24577 CFNetwork/3860.300.31 Darwin/25.2.0" };

describe("Tool bridge integration — Claude", () => {
  let app: FastifyInstance;

  afterEach(async () => { await app.close(); });

  it("emits tool_use blocks when model requests bridge tools", async () => {
    const ctx = createCtx(
      toolRequestSequence({
        deltas: ["Let me check"],
        toolRequests: [
          { toolCallId: "tc1", name: `${BRIDGE_TOOL_PREFIX}XcodeRead`, arguments: { path: "/src" } },
        ],
      }),
      toolBridgeConfig,
    );
    app = await createApp(ctx, claudeProvider);

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { ...claudeHeaders, "content-type": "application/json" },
      payload: {
        model: "test-model",
        messages: [{ role: "user", content: "Read my code" }],
        max_tokens: 100,
        tools: [{ name: "XcodeRead", description: "Read file", input_schema: { type: "object" } }],
      },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSELines(res.body) as Record<string, unknown>[];

    const toolUseStart = events.find(
      (e) => e.type === "content_block_start" && (e.content_block as Record<string, unknown>).type === "tool_use",
    );
    expect(toolUseStart).toBeDefined();

    const block = toolUseStart!.content_block as Record<string, unknown>;
    expect(block.id).toBe("tc1");
    expect(block.name).toBe("XcodeRead");

    const inputDelta = events.find(
      (e) => e.type === "content_block_delta" && (e.delta as Record<string, unknown>).type === "input_json_delta",
    );
    expect(inputDelta).toBeDefined();
  });
});

describe("Tool bridge integration — Codex", () => {
  let app: FastifyInstance;

  afterEach(async () => { await app.close(); });

  it("emits function_call items when model requests bridge tools", async () => {
    const ctx = createCtx(
      toolRequestSequence({
        deltas: ["Let me check"],
        toolRequests: [
          { toolCallId: "tc1", name: `${BRIDGE_TOOL_PREFIX}XcodeRead`, arguments: { path: "/src" } },
        ],
      }),
      toolBridgeConfig,
    );
    app = await createApp(ctx, codexProvider);

    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { ...codexHeaders, "content-type": "application/json" },
      payload: {
        model: "test-model",
        input: "Read my code",
        tools: [{ type: "function", name: "XcodeRead", description: "Read file", parameters: { type: "object" } }],
      },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSELines(res.body) as Record<string, unknown>[];

    // The first output_item.added is the "message" item, not the function_call
    const fcAdded = events.find(
      (e) => e.type === "response.output_item.added" && (e as { item?: { type?: string } }).item?.type === "function_call",
    );
    expect(fcAdded).toBeDefined();

    const item = (fcAdded as { item?: Record<string, unknown> }).item;
    expect(item?.name).toBe("XcodeRead");
    expect(item?.call_id).toBe("tc1");
  });
});

describe("MCP routes", () => {
  let app: FastifyInstance;

  afterEach(async () => { await app.close(); });

  it("responds to initialize with protocol version and capabilities", async () => {
    const ctx = createCtx(standardSequence({ deltas: ["x"] }), toolBridgeConfig);
    app = await createApp(ctx, claudeProvider);

    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv-id",
      headers: { "content-type": "application/json" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.capabilities).toEqual({ tools: {} });
    expect(body.result.serverInfo.name).toBe("xcode-bridge");
  });

  it("returns method not found for unknown methods", async () => {
    const ctx = createCtx(standardSequence({ deltas: ["x"] }), toolBridgeConfig);
    app = await createApp(ctx, claudeProvider);

    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv-id",
      headers: { "content-type": "application/json" },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "unknown/method",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("returns parse error for invalid JSON-RPC", async () => {
    const ctx = createCtx(standardSequence({ deltas: ["x"] }), toolBridgeConfig);
    app = await createApp(ctx, claudeProvider);

    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv-id",
      headers: { "content-type": "application/json" },
      payload: { invalid: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error.code).toBe(-32700);
  });

  it("accepts notifications (no id) with 202", async () => {
    const ctx = createCtx(standardSequence({ deltas: ["x"] }), toolBridgeConfig);
    app = await createApp(ctx, claudeProvider);

    const res = await app.inject({
      method: "POST",
      url: "/mcp/test-conv-id",
      headers: { "content-type": "application/json" },
      payload: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
    });

    expect(res.statusCode).toBe(202);
  });

  // Can't test the SSE GET route with app.inject() — it holds the connection open forever
});

describe("GET /health", () => {
  let app: FastifyInstance;

  afterEach(async () => { await app.close(); });

  it("returns 200 with status ok when ping succeeds", async () => {
    const ctx = createCtx(standardSequence({ deltas: ["x"] }));
    app = await createApp(ctx, openaiProvider);

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: xcodeHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("returns 503 when ping fails", async () => {
    const ctx: AppContext = {
      ...createCtx(standardSequence({ deltas: ["x"] })),
      service: {
        ping: () => Promise.reject(new Error("connection lost")),
      } as unknown as AppContext["service"],
    };
    app = await createApp(ctx, openaiProvider);

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: xcodeHeaders,
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", message: "connection lost" });
  });
});
