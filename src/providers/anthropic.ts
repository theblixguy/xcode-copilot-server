import type { Provider } from "./types.js";
import { registerToolBridge } from "../tool-bridge/index.js";
import { createMessagesHandler } from "../handlers/messages.js";
import { createCountTokensHandler } from "../handlers/messages/count-tokens.js";

export const anthropicProvider = {
  name: "Anthropic",
  routes: ["POST /v1/messages", "POST /v1/messages/count_tokens"],

  register(app, ctx) {
    app.addHook("onRequest", (request, reply, done) => {
      // Internal routes are called by the MCP tool bridge script (no UA)
      if (request.url.startsWith("/internal/")) {
        done();
        return;
      }
      const ua = request.headers["user-agent"] ?? "";
      if (!ua.startsWith("claude-cli/")) {
        ctx.logger.warn(`Rejected request from unexpected user-agent: ${ua}`);
        void reply.code(403).type("application/json").send('{"error":"Forbidden"}\n');
        return;
      }
      done();
    });

    const manager = registerToolBridge(app, ctx.logger);
    app.post("/v1/messages", createMessagesHandler(ctx, manager));
    app.post("/v1/messages/count_tokens", createCountTokensHandler(ctx));
  },
} satisfies Provider;
