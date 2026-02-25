import type { FastifyInstance } from "fastify";
import type { Logger } from "copilot-sdk-proxy";
import { ConversationManager } from "../conversation-manager.js";
import { registerRoutes } from "./routes.js";

export { BRIDGE_SERVER_NAME, BRIDGE_TOOL_PREFIX } from "./constants.js";

export function registerToolBridge(app: FastifyInstance, logger: Logger): ConversationManager {
  const manager = new ConversationManager(logger);
  registerRoutes(app, manager, logger);
  return manager;
}
