import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { ConversationManager } from "../conversation-manager.js";
import type { Logger } from "../logger.js";

const ToolCallBodySchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

export function registerRoutes(
  app: FastifyInstance,
  manager: ConversationManager,
  logger: Logger,
): void {
  app.get(
    "/internal/:convId/tools",
    (request: FastifyRequest<{ Params: { convId: string } }>, reply: FastifyReply) => {
      const state = manager.getState(request.params.convId);
      if (!state) {
        logger.warn(`/internal/${request.params.convId}/tools: conversation not found`);
        return reply.status(404).send({ error: "Conversation not found" });
      }
      const tools = state.getCachedTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
      }));
      logger.debug(`/internal/${request.params.convId}/tools: returning ${String(tools.length)} tools: ${tools.map((t) => t.name).join(", ")}`);
      return reply.send(tools);
    },
  );

  app.post(
    "/internal/:convId/tool-call",
    async (request: FastifyRequest<{ Params: { convId: string } }>, reply: FastifyReply) => {
      const parsed = ToolCallBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Invalid request",
        });
      }
      const { name, arguments: args } = parsed.data;

      const state = manager.getState(request.params.convId);
      if (!state) {
        logger.warn(`/internal/${request.params.convId}/tool-call: conversation not found for "${name}"`);
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const resolved = state.resolveToolName(name);
      if (resolved !== name) {
        logger.info(`/internal/${request.params.convId}/tool-call: name="${name}" resolved to "${resolved}", args=${JSON.stringify(args)}`);
      } else {
        logger.info(`/internal/${request.params.convId}/tool-call: name="${name}", args=${JSON.stringify(args)}`);
      }

      const result = await new Promise<string>((resolve, reject) => {
        state.registerMCPRequest(resolved, resolve, reject);
      });

      logger.debug(`/internal/${request.params.convId}/tool-call resolved: name="${name}"`);
      return reply.send({ content: result });
    },
  );
}
