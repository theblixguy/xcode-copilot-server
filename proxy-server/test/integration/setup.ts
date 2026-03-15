import { beforeAll, afterAll } from "vitest";
import { createMock, type MockServer } from "llm-mock-server";
import type { SessionConfig } from "copilot-sdk-proxy";
import { createServer, CopilotService, Logger, Stats } from "copilot-sdk-proxy";
import type { AppContext } from "../../src/context.js";
import type { ServerConfig } from "../../src/config-schema.js";
import { BYTES_PER_MIB } from "../../src/config-schema.js";
import type { Provider } from "../../src/providers/types.js";

export const TIMEOUT = 60_000;
export const OPENAI_MODEL = "gpt-5.4";
export const CLAUDE_MODEL = "claude-sonnet-4-6";

let service: CopilotService;
export let mock: MockServer;

const logger = new Logger("none");

beforeAll(async () => {
  mock = await createMock({ port: 0 });

  mock.when("hello").reply("Hello from mock!");
  mock.when("capital of France").reply("The capital of France is Paris.");
  mock.when(/what word/i).reply("The word was banana.");
  mock.when("think about life").reply({
    text: "The answer is 42.",
    reasoning: "Let me think step by step about the meaning of life...",
  });
  mock.when("read the file").reply({
    tools: [{ name: "read_file", args: { path: "/tmp/test.txt" } }],
  });
  mock.when("say nothing").reply("");
  mock.fallback("I'm a mock server.");

  service = new CopilotService({
    logger,
    githubToken: process.env.GITHUB_TOKEN ?? "dummy-token-for-byok",
  });
  await service.start();
}, TIMEOUT);

afterAll(async () => {
  await service.stop();
  await mock.stop();
}, TIMEOUT);

export async function startServer(
  provider: Provider,
  byokProvider: SessionConfig["provider"],
  configOverrides?: Partial<ServerConfig>,
) {
  const config: ServerConfig = {
    toolBridge: false,
    toolBridgeTimeoutMs: 0,
    mcpServers: {},
    allowedCliTools: ["test"],
    excludedFilePatterns: [],
    bodyLimit: 10 * BYTES_PER_MIB,
    requestTimeoutMs: 0,
    autoApprovePermissions: true,
    ...configOverrides,
  };

  const ctx: AppContext & { provider: SessionConfig["provider"] } = {
    service,
    logger,
    config,
    port: 0,
    stats: new Stats(),
    provider: byokProvider,
  };
  const app = await createServer(ctx, provider);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, baseUrl: address, ctx };
}

export async function postJSON(
  baseUrl: string,
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: string; contentType: string | null }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get("content-type"),
  };
}

export function parseSSELines(body: string): unknown[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as unknown);
}
