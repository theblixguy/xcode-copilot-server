import type { Provider } from "./types.js";
import { createModelsHandler } from "../handlers/models.js";
import { createCompletionsHandler } from "../handlers/completions.js";

export const openaiProvider = {
  name: "OpenAI",
  routes: ["GET /v1/models", "POST /v1/chat/completions"],

  register(app, ctx) {
    app.addHook("onRequest", (request, reply, done) => {
      const ua = request.headers["user-agent"] ?? "";
      if (!ua.startsWith("Xcode/")) {
        ctx.logger.warn(
          `Rejected request from unexpected user-agent: ${ua}`,
        );
        void reply
          .code(403)
          .type("application/json")
          .send('{"error":"Forbidden"}\n');
        return;
      }

      done();
    });

    app.get("/v1/models", createModelsHandler(ctx));
    app.post("/v1/chat/completions", createCompletionsHandler(ctx));
  },
} satisfies Provider;
