import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppContext } from "./context.js";
import type { LogLevel } from "./logger.js";
import { createModelsHandler } from "./handlers/models.js";
import { createCompletionsHandler } from "./handlers/completions.js";

const PINO_LEVEL: Record<LogLevel, string> = {
  none: "silent",
  error: "error",
  warning: "warn",
  info: "info",
  debug: "debug",
  all: "trace",
};

export async function createServer(
  ctx: AppContext,
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: ctx.config.bodyLimit,
    // Destroy active connections immediately on close() so shutdown doesn't
    // hang waiting for SSE streams or pending requests to drain.
    forceCloseConnections: true,
    logger: {
      level: PINO_LEVEL[ctx.logger.level],
    },
  });

  await app.register(cors, {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

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

  return app;
}
