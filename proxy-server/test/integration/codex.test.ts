import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { codexProvider } from "../../src/providers/codex/provider.js";
import { TIMEOUT, OPENAI_MODEL, startServer, postJSON, parseSSELines, mock } from "./setup.js";

const PATH = "/v1/responses";
const UA = { "user-agent": "Xcode/16000 CFNetwork/1 Darwin/25.0.0" };
const msg = (input: string | { role: string; content: string }[]) => ({ model: OPENAI_MODEL, input });
const byok = () => ({ type: "openai" as const, wireApi: "responses" as const, baseUrl: `${mock.url}/v1` });
const post = (baseUrl: string, body: unknown) => postJSON(baseUrl, PATH, body, UA);

function textFrom(res: { body: string }): string {
  return (parseSSELines(res.body) as { type?: string; delta?: string }[])
    .filter((e) => e.type === "response.output_text.delta")
    .map((e) => e.delta ?? "")
    .join("");
}

describe("Codex provider", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = await startServer(codexProvider, byok());
    baseUrl = server.baseUrl;
    close = () => server.app.close();
  }, TIMEOUT);

  afterEach(async () => { await close(); });

  it("streams a basic response with Responses API events", async () => {
    const res = await post(baseUrl, msg("hello"));

    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/event-stream");
    expect(textFrom(res)).toBe("Hello from mock!");

    const types = (parseSSELines(res.body) as { type?: string }[]).map((e) => e.type).filter(Boolean);
    expect(types).toContain("response.created");
    expect(types).toContain("response.output_item.added");
    expect(types).toContain("response.content_part.added");
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.output_text.done");
    expect(types).toContain("response.completed");
  }, TIMEOUT);

  it("streams with instructions", async () => {
    const res = await post(baseUrl, {
      ...msg("capital of France"),
      instructions: "You are helpful.",
    });

    expect(res.status).toBe(200);
    expect(textFrom(res)).toBe("The capital of France is Paris.");
  }, TIMEOUT);

  it("handles multi-turn via input array", async () => {
    const res = await post(baseUrl, msg([
      { role: "user", content: "remember the word banana" },
      { role: "assistant", content: "OK" },
      { role: "user", content: "what word did I ask you to remember?" },
    ]));

    expect(res.status).toBe(200);
    expect(textFrom(res)).toBe("The word was banana.");
  }, TIMEOUT);

  it("streams response with reasoning reply", async () => {
    const res = await post(baseUrl, msg("think about life"));
    expect(res.status).toBe(200);
    expect(textFrom(res)).toBe("The answer is 42.");
  }, TIMEOUT);

  it("uses fallback for unmatched messages", async () => {
    const res = await post(baseUrl, msg("something random"));
    expect(res.status).toBe(200);
    expect(textFrom(res)).toBe("I'm a mock server.");
  }, TIMEOUT);

  it("streams an empty response without errors", async () => {
    const res = await post(baseUrl, msg("say nothing"));
    expect(res.status).toBe(200);
    const types = (parseSSELines(res.body) as { type?: string }[]).map((e) => e.type).filter(Boolean);
    expect(types).toContain("response.completed");
  }, TIMEOUT);

  it("rejects missing input", async () => {
    const res = await post(baseUrl, { model: OPENAI_MODEL });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  it("rejects missing model", async () => {
    const res = await post(baseUrl, { input: "hello" });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  it("rejects requests with wrong user-agent", async () => {
    const res = await postJSON(baseUrl, PATH, msg("hello"), { "user-agent": "curl/1.0" });
    expect(res.status).toBe(403);
  }, TIMEOUT);

  it("rejects requests with missing user-agent", async () => {
    const res = await fetch(`${baseUrl}${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg("hello")),
    });
    expect(res.status).toBe(403);
  }, TIMEOUT);

  it("rejects non-streaming requests", async () => {
    const res = await post(baseUrl, { ...msg("hello"), stream: false });
    expect(res.status).toBe(400);
  }, TIMEOUT);
});

describe("Codex provider - usage stats", () => {
  it("records usage stats", async () => {
    const server = await startServer(codexProvider, byok());
    try {
      await post(server.baseUrl, msg("hello"));
      const snap = server.ctx.stats.snapshot();
      expect(snap.requests).toBe(1);
      expect(snap.sessions).toBe(1);
    } finally {
      await server.app.close();
    }
  }, TIMEOUT);

  it("records multiple requests across turns", async () => {
    const server = await startServer(codexProvider, byok());
    try {
      await post(server.baseUrl, msg("hello"));
      await post(server.baseUrl, msg([
        { role: "user", content: "hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "capital of France" },
      ]));
      expect(server.ctx.stats.snapshot().requests).toBe(2);
    } finally {
      await server.app.close();
    }
  }, TIMEOUT);
});
