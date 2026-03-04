import type { FastifyInstance } from "fastify";
import type { Logger } from "copilot-sdk-proxy";

// /mcp/ routes are exempt because they're internal SDK traffic on localhost.
export function addUserAgentGuard(
  app: FastifyInstance,
  uaPrefix: string,
  logger: Logger,
): void {
  app.addHook("onRequest", (request, reply, done) => {
    if (request.url.startsWith("/mcp/")) {
      done();
      return;
    }
    const ua = request.headers["user-agent"] ?? "";
    if (!ua.startsWith(uaPrefix)) {
      logger.warn(`Rejected request from unexpected user-agent: ${ua}`);
      void reply.code(403).type("application/json").send('{"error":"Forbidden"}\n');
      return;
    }
    done();
  });
}
