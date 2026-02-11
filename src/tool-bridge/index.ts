import type { FastifyInstance } from "fastify";
import type { Logger } from "../logger.js";
import { ConversationManager } from "../conversation-manager.js";
import { registerRoutes } from "./routes.js";

export { ToolBridgeState } from "./state.js";
export { ConversationManager } from "../conversation-manager.js";

export function registerToolBridge(app: FastifyInstance, logger: Logger): ConversationManager {
  const manager = new ConversationManager(logger);
  registerRoutes(app, manager, logger);
  return manager;
}
