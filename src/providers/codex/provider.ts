import type { Provider } from "../types.js";
import { registerToolBridge } from "../../tool-bridge/index.js";
import { createResponsesHandler } from "./handler.js";

export const codexProvider = {
  name: "Codex",
  routes: ["POST /v1/responses"],

  register(app, ctx) {
    app.addHook("onRequest", (request, reply, done) => {
      if (request.url.startsWith("/mcp/")) {
        done();
        return;
      }
      const ua = request.headers["user-agent"] ?? "";
      if (!ua.startsWith("Xcode/")) {
        ctx.logger.warn(`Rejected request from unexpected user-agent: ${ua}`);
        void reply.code(403).type("application/json").send('{"error":"Forbidden"}\n');
        return;
      }
      done();
    });

    const manager = registerToolBridge(app, ctx.logger);
    app.post("/v1/responses", createResponsesHandler(ctx, manager));
  },
} satisfies Provider;
