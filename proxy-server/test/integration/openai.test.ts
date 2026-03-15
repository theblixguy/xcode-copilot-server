import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openaiProvider } from "../../src/providers/openai/provider.js";
import { TIMEOUT, OPENAI_MODEL, startServer, postJSON, parseSSELines, mock } from "./setup.js";

const PATH = "/v1/chat/completions";
const UA = { "user-agent": "Xcode/16000 CFNetwork/1 Darwin/25.0.0" };
const msg = (content: string) => ({ model: OPENAI_MODEL, messages: [{ role: "user", content }] });
const byok = () => ({ type: "openai" as const, baseUrl: `${mock.url}/v1` });
const post = (baseUrl: string, body: unknown) => postJSON(baseUrl, PATH, body, UA);

function textFrom(res: { body: string }): string {
  return (parseSSELines(res.body) as { choices?: { delta?: { content?: string } }[] }[])
    .flatMap((e) => e.choices ?? [])
    .map((c) => c.delta?.content ?? "")
    .filter(Boolean)
    .join("");
}

describe("OpenAI provider", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = await startServer(openaiProvider, byok());
    baseUrl = server.baseUrl;
    close = () => server.app.close();
  }, TIMEOUT);

  afterEach(async () => { await close(); });

  it("streams a basic response", async () => {
    const res = await post(baseUrl, msg("hello"));

    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/event-stream");
    expect(res.body).toContain("data: [DONE]");
    expect(textFrom(res)).toBe("Hello from mock!");
  }, TIMEOUT);

  it("streams with a system message", async () => {
    const res = await post(baseUrl, {
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "capital of France" },
      ],
    });

    expect(res.status).toBe(200);
    expect(textFrom(res)).toBe("The capital of France is Paris.");
  }, TIMEOUT);

  it("handles multi-turn conversation", async () => {
    const res = await post(baseUrl, {
      model: OPENAI_MODEL,
      messages: [
        { role: "user", content: "remember the word banana" },
        { role: "assistant", content: "OK" },
        { role: "user", content: "what word did I ask you to remember?" },
      ],
    });

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
    expect(res.body).toContain("data: [DONE]");
  }, TIMEOUT);

  it("rejects non-streaming requests", async () => {
    const res = await post(baseUrl, { ...msg("hello"), stream: false });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  it("rejects invalid schema", async () => {
    const res = await post(baseUrl, { model: OPENAI_MODEL, messages: "not an array" });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  it("rejects missing model", async () => {
    const res = await post(baseUrl, { messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  it("rejects empty messages array", async () => {
    const res = await post(baseUrl, { model: OPENAI_MODEL, messages: [] });
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

  it("strips excluded file code blocks from prompt", async () => {
    mock.history.clear();
    const server = await startServer(openaiProvider, byok(), {
      excludedFilePatterns: ["secret.ts"],
    });
    try {
      const content = [
        "Here is some code:",
        "```swift:main.swift",
        "print(\"hello\")",
        "```",
        "```typescript:secret.ts",
        "const API_KEY = \"sk-1234\";",
        "```",
        "Please review.",
      ].join("\n");

      await post(server.baseUrl, {
        model: OPENAI_MODEL,
        messages: [{ role: "user", content }],
      });

      const lastReq = mock.history.last();
      expect(lastReq).toBeDefined();
      const lastMessage = lastReq!.request.lastMessage;
      expect(lastMessage).toContain("main.swift");
      expect(lastMessage).not.toContain("secret.ts");
      expect(lastMessage).not.toContain("sk-1234");
    } finally {
      await server.app.close();
    }
  }, TIMEOUT);

  it("GET /health returns 200", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: UA,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  }, TIMEOUT);
});

describe("OpenAI provider - usage stats", () => {
  it("records usage stats", async () => {
    const server = await startServer(openaiProvider, byok());
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
    const server = await startServer(openaiProvider, byok());
    try {
      await post(server.baseUrl, msg("hello"));
      await post(server.baseUrl, {
        model: OPENAI_MODEL,
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "capital of France" },
        ],
      });
      expect(server.ctx.stats.snapshot().requests).toBe(2);
    } finally {
      await server.app.close();
    }
  }, TIMEOUT);
});
