import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, CopilotService, Logger, Stats } from "copilot-sdk-proxy";
import { openaiProvider } from "../../src/providers/openai/provider.js";
import { claudeProvider } from "../../src/providers/claude/provider.js";
import { codexProvider } from "../../src/providers/codex/provider.js";
import type { AppContext } from "../../src/context.js";
import { BYTES_PER_MIB, type ServerConfig } from "../../src/config-schema.js";
import type { Provider } from "../../src/providers/types.js";

const OPENAI_MODELS = ["claude-sonnet-4-6", "gpt-5.3"];
const CLAUDE_MODELS = ["claude-sonnet-4-6"];
const CODEX_MODELS = ["gpt-5.3"];
const TIMEOUT = 60_000;

let service: CopilotService;
const logger = new Logger("info");

const config: ServerConfig = {
  toolBridge: false,
  toolBridgeTimeoutMs: 0,
  mcpServers: {},
  allowedCliTools: ["*"],
  excludedFilePatterns: [],
  bodyLimit: 10 * BYTES_PER_MIB,
  requestTimeoutMs: 0,
  autoApprovePermissions: true,
};

beforeAll(async () => {
  service = new CopilotService({ logger });
  await service.start();

  const auth = await service.getAuthStatus();
  if (!auth.isAuthenticated) {
    throw new Error("Copilot not authenticated. Sign in first.");
  }
}, TIMEOUT);

afterAll(async () => {
  await service.stop();
}, TIMEOUT);

function createCtx(): AppContext {
  return {
    service,
    logger,
    config,
    port: 0,
    stats: new Stats(),
  };
}

const xcodeHeaders = { "user-agent": "Xcode/24577 CFNetwork/3860.300.31 Darwin/25.2.0" };
const claudeCliHeaders = { "user-agent": "claude-cli/1.0" };
const codexHeaders = { "user-agent": "Xcode/24577 CFNetwork/3860.300.31 Darwin/25.2.0" };

async function startServer(provider: Provider) {
  const ctx = createCtx();
  const app = await createServer(ctx, provider);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, baseUrl: address, ctx };
}

async function postJSON(baseUrl: string, path: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

function parseSSELines(body: string): unknown[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as unknown);
}

function collectOpenAIText(events: unknown[]): string {
  return (events as { choices?: { delta?: { content?: string } }[] }[])
    .flatMap((e) => e.choices ?? [])
    .map((c) => c.delta?.content ?? "")
    .filter(Boolean)
    .join("");
}

function collectClaudeText(events: unknown[]): string {
  return (events as { type?: string; delta?: { type?: string; text?: string } }[])
    .filter((e) => e.type === "content_block_delta" && e.delta?.type === "text_delta")
    .map((e) => e.delta?.text ?? "")
    .join("");
}

function collectCodexText(events: unknown[]): string {
  return (events as { type?: string; delta?: string }[])
    .filter((e) => e.type === "response.output_text.delta")
    .map((e) => e.delta ?? "")
    .join("");
}

describe.each(OPENAI_MODELS)("OpenAI provider with %s", (model) => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = await startServer(openaiProvider);
    baseUrl = server.baseUrl;
    close = () => server.app.close();
  }, TIMEOUT);

  afterEach(async () => { await close(); });

  it("streams a basic response", async () => {
    const res = await postJSON(baseUrl, "/v1/chat/completions", {
      model,
      messages: [{ role: "user", content: "Reply with exactly: hello" }],
    }, xcodeHeaders);

    expect(res.status).toBe(200);
    const text = collectOpenAIText(parseSSELines(res.body));
    expect(text.toLowerCase()).toContain("hello");
    expect(res.body).toContain("data: [DONE]");
  }, TIMEOUT);

  it("streams with a system message", async () => {
    const res = await postJSON(baseUrl, "/v1/chat/completions", {
      model,
      messages: [
        { role: "system", content: "You are a calculator. Only respond with numbers." },
        { role: "user", content: "What is 2+2?" },
      ],
    }, xcodeHeaders);

    expect(res.status).toBe(200);
    const text = collectOpenAIText(parseSSELines(res.body));
    expect(text).toContain("4");
  }, TIMEOUT);

  it("streams reasoning content", async () => {
    const res = await postJSON(baseUrl, "/v1/chat/completions", {
      model,
      messages: [{ role: "user", content: "Think step by step: what is 15 * 17?" }],
    }, xcodeHeaders);

    expect(res.status).toBe(200);
    const events = parseSSELines(res.body);
    const text = collectOpenAIText(events);
    expect(text).toContain("255");
  }, TIMEOUT);

  it("handles multi-turn conversation", async () => {
    const res = await postJSON(baseUrl, "/v1/chat/completions", {
      model,
      messages: [
        { role: "user", content: "Remember the word 'banana'. Just say OK." },
        { role: "assistant", content: "OK" },
        { role: "user", content: "What word did I ask you to remember?" },
      ],
    }, xcodeHeaders);

    expect(res.status).toBe(200);
    const text = collectOpenAIText(parseSSELines(res.body));
    expect(text.toLowerCase()).toContain("banana");
  }, TIMEOUT);

  it("rejects invalid schema", async () => {
    const res = await postJSON(baseUrl, "/v1/chat/completions", {
      model,
      messages: "not an array",
    }, xcodeHeaders);

    expect(res.status).toBe(400);
  }, TIMEOUT);
});

describe.each(CLAUDE_MODELS)("Claude provider with %s", (model) => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = await startServer(claudeProvider);
    baseUrl = server.baseUrl;
    close = () => server.app.close();
  }, TIMEOUT);

  afterEach(async () => { await close(); });

  it("streams a basic response", async () => {
    const res = await postJSON(baseUrl, "/v1/messages", {
      model,
      messages: [{ role: "user", content: "Reply with exactly: hello" }],
      max_tokens: 100,
    }, claudeCliHeaders);

    expect(res.status).toBe(200);
    const events = parseSSELines(res.body);
    const text = collectClaudeText(events);
    expect(text.toLowerCase()).toContain("hello");

    const types = (events as { type?: string }[]).map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("message_stop");
  }, TIMEOUT);

  it("streams with a system message", async () => {
    const res = await postJSON(baseUrl, "/v1/messages", {
      model,
      system: "You are a calculator. Only respond with numbers.",
      messages: [{ role: "user", content: "What is 3+3?" }],
      max_tokens: 100,
    }, claudeCliHeaders);

    expect(res.status).toBe(200);
    const text = collectClaudeText(parseSSELines(res.body));
    expect(text).toContain("6");
  }, TIMEOUT);

  it("streams reasoning content via thinking blocks", async () => {
    const res = await postJSON(baseUrl, "/v1/messages", {
      model,
      messages: [{ role: "user", content: "Think step by step: what is 15 * 17?" }],
      max_tokens: 16000,
    }, claudeCliHeaders);

    expect(res.status).toBe(200);
    const events = parseSSELines(res.body);
    const text = collectClaudeText(events);
    expect(text).toContain("255");

    const types = (events as { type?: string }[]).map((e) => e.type);
    expect(types).toContain("content_block_start");
    expect(types).toContain("content_block_delta");
  }, TIMEOUT);

  it("handles multi-turn conversation", async () => {
    const res = await postJSON(baseUrl, "/v1/messages", {
      model,
      messages: [
        { role: "user", content: "Remember the word 'mango'. Just say OK." },
        { role: "assistant", content: "OK" },
        { role: "user", content: "What word did I ask you to remember?" },
      ],
      max_tokens: 100,
    }, claudeCliHeaders);

    expect(res.status).toBe(200);
    const text = collectClaudeText(parseSSELines(res.body));
    expect(text.toLowerCase()).toContain("mango");
  }, TIMEOUT);

  it("rejects missing max_tokens", async () => {
    const res = await postJSON(baseUrl, "/v1/messages", {
      model,
      messages: [{ role: "user", content: "Hi" }],
    }, claudeCliHeaders);

    expect(res.status).toBe(400);
  }, TIMEOUT);
});

describe.each(CODEX_MODELS)("Codex provider with %s", (model) => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = await startServer(codexProvider);
    baseUrl = server.baseUrl;
    close = () => server.app.close();
  }, TIMEOUT);

  afterEach(async () => { await close(); });

  it("streams a basic response", async () => {
    const res = await postJSON(baseUrl, "/v1/responses", { model, input: "Reply with exactly: hello" }, codexHeaders);

    expect(res.status).toBe(200);
    const events = parseSSELines(res.body);
    const text = collectCodexText(events);
    expect(text.toLowerCase()).toContain("hello");

    const types = (events as { type?: string }[]).map((e) => e.type).filter(Boolean);
    expect(types).toContain("response.created");
    expect(types).toContain("response.completed");
  }, TIMEOUT);

  it("streams with instructions", async () => {
    const res = await postJSON(baseUrl, "/v1/responses", {
      model,
      instructions: "You are a calculator. Only respond with numbers.",
      input: "What is 5+5?",
    }, codexHeaders);

    expect(res.status).toBe(200);
    const text = collectCodexText(parseSSELines(res.body));
    expect(text).toContain("10");
  }, TIMEOUT);

  it("streams reasoning content", async () => {
    const res = await postJSON(baseUrl, "/v1/responses", {
      model,
      input: "Think step by step: what is 15 * 17?",
    }, codexHeaders);

    expect(res.status).toBe(200);
    const events = parseSSELines(res.body);
    const text = collectCodexText(events);
    expect(text).toContain("255");

    const types = (events as { type?: string }[]).map((e) => e.type).filter(Boolean);
    expect(types).toContain("response.completed");
  }, TIMEOUT);

  it("handles multi-turn via input array", async () => {
    const res = await postJSON(baseUrl, "/v1/responses", {
      model,
      input: [
        { role: "user", content: "Remember the word 'cherry'. Just say OK." },
        { role: "assistant", content: "OK" },
        { role: "user", content: "What word did I ask you to remember?" },
      ],
    }, codexHeaders);

    expect(res.status).toBe(200);
    const text = collectCodexText(parseSSELines(res.body));
    expect(text.toLowerCase()).toContain("cherry");
  }, TIMEOUT);

  it("rejects missing input", async () => {
    const res = await postJSON(baseUrl, "/v1/responses", { model }, codexHeaders);

    expect(res.status).toBe(400);
  }, TIMEOUT);
});
