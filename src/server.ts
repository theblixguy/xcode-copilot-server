import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppContext } from "./context.js";
import type { LogLevel } from "./logger.js";
import type { Provider } from "./providers/types.js";

const PINO_LEVEL = {
  none: "silent",
  error: "error",
  warning: "warn",
  info: "info",
  debug: "debug",
  all: "trace",
} satisfies Record<LogLevel, string>;

export async function createServer(
  ctx: AppContext,
  provider: Provider,
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
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "anthropic-beta",
      "anthropic-version",
      "x-api-key",
    ],
  });

  provider.register(app, ctx);

  return app;
}
