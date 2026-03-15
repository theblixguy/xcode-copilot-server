import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { claudeProvider } from "../../src/providers/claude/provider.js";
import { TIMEOUT, CLAUDE_MODEL, startServer, postJSON, parseSSELines, mock } from "./setup.js";

const PATH = "/v1/messages";
const UA = { "user-agent": "claude-cli/1.0" };
const msg = (content: string, max_tokens = 100) => ({
  model: CLAUDE_MODEL, messages: [{ role: "user", content }], max_tokens,
});
const byok = () => ({ type: "anthropic" as const, baseUrl: mock.url, apiKey: "dummy" });
const post = (baseUrl: string, body: unknown) => postJSON(baseUrl, PATH, body, UA);

function textFrom(res: { body: string }): string {
  return (parseSSELines(res.body) as { type?: string; delta?: { type?: string; text?: string } }[])
    .filter((e) => e.type === "content_block_delta" && e.delta?.type === "text_delta")
    .map((e) => e.delta?.text ?? "")
    .join("");
}

describe("Claude provider", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = await startServer(claudeProvider, byok());
    baseUrl = server.baseUrl;
    close = () => server.app.close();
  }, TIMEOUT);

  afterEach(async () => { await close(); });

  it("streams a basic response with Anthropic SSE events", async () => {
    const res = await post(baseUrl, msg("hello"));

    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/event-stream");
    expect(textFrom(res)).toBe("Hello from mock!");

    const types = (parseSSELines(res.body) as { type?: string }[]).map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("content_block_start");
    expect(types).toContain("content_block_delta");
    expect(types).toContain("content_block_stop");
    expect(types).toContain("message_delta");
    expect(types).toContain("message_stop");
  }, TIMEOUT);

  it("streams with a system message", async () => {
    const res = await post(baseUrl, {
      ...msg("capital of France"),
      system: "You are helpful.",
    });

    expect(res.status).toBe(200);
    expect(textFrom(res)).toBe("The capital of France is Paris.");
  }, TIMEOUT);

  it("handles multi-turn conversation", async () => {
    const res = await post(baseUrl, {
      model: CLAUDE_MODEL,
      messages: [
        { role: "user", content: "remember the word banana" },
        { role: "assistant", content: "OK" },
        { role: "user", content: "what word did I ask you to remember?" },
      ],
      max_tokens: 100,
    });

    expect(res.status).toBe(200);
    expect(textFrom(res)).toBe("The word was banana.");
  }, TIMEOUT);

  it("streams response with reasoning reply", async () => {
    const res = await post(baseUrl, msg("think about life", 16000));
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
    const types = (parseSSELines(res.body) as { type?: string }[]).map((e) => e.type);
    expect(types).toContain("message_stop");
  }, TIMEOUT);

  it("rejects missing max_tokens", async () => {
    const res = await post(baseUrl, {
      model: CLAUDE_MODEL, messages: [{ role: "user", content: "hello" }],
    });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  it("rejects missing model", async () => {
    const res = await post(baseUrl, {
      messages: [{ role: "user", content: "hello" }], max_tokens: 100,
    });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  it("rejects empty messages array", async () => {
    const res = await post(baseUrl, {
      model: CLAUDE_MODEL, messages: [], max_tokens: 100,
    });
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

describe("Claude provider - usage stats", () => {
  it("records usage stats", async () => {
    const server = await startServer(claudeProvider, byok());
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
    const server = await startServer(claudeProvider, byok());
    try {
      await post(server.baseUrl, msg("hello"));
      await post(server.baseUrl, {
        model: CLAUDE_MODEL,
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "capital of France" },
        ],
        max_tokens: 100,
      });
      expect(server.ctx.stats.snapshot().requests).toBe(2);
    } finally {
      await server.app.close();
    }
  }, TIMEOUT);
});
