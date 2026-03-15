import type { FastifyInstance } from "fastify";
import type { Logger } from "copilot-sdk-proxy";
import { ConversationManager } from "../conversation-manager.js";
import { registerRoutes } from "./routes.js";

export function registerToolBridge(
  app: FastifyInstance,
  logger: Logger,
  toolBridgeTimeoutMs = 0,
): ConversationManager {
  const manager = new ConversationManager(logger, toolBridgeTimeoutMs);
  registerRoutes(app, manager, logger);
  return manager;
}

// Auto mode uses a shared manager; standalone mode creates one per provider.
export function resolveToolBridgeManager(
  app: FastifyInstance,
  existing: ConversationManager | undefined,
  logger: Logger,
  toolBridgeTimeoutMs = 0,
): ConversationManager {
  return existing ?? registerToolBridge(app, logger, toolBridgeTimeoutMs);
}
