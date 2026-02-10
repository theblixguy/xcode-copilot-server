import type { FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "../context.js";
import { currentTimestamp } from "../schemas.js";
import type { ModelsResponse } from "../types.js";

export function createModelsHandler({ service, logger }: AppContext) {
  return async function handleModels(
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const models = await service.listModels();

      const response: ModelsResponse = {
        object: "list",
        data: models.map((m) => ({
          id: m.id,
          object: "model",
          created: currentTimestamp(),
          owned_by: "github-copilot",
        })),
      };

      reply.send(response);
    } catch (err) {
      logger.error("Couldn't fetch models:", err);
      reply.status(500).send({
        error: {
          message: "Failed to list models",
          type: "api_error",
        },
      });
    }
  };
}
