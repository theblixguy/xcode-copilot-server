import type { CopilotService, Logger, Stats } from "copilot-sdk-proxy";
import type { ServerConfig } from "./config-schema.js";
import type { ConversationManager } from "./conversation-manager.js";

export interface AppContext {
  service: CopilotService;
  logger: Logger;
  config: ServerConfig;
  port: number;
  stats: Stats;
  // In auto mode, a shared manager avoids duplicate MCP route registration.
  toolBridgeManager?: ConversationManager | undefined;
}
