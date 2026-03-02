import type { CopilotService, Logger, Stats } from "copilot-sdk-proxy";
import type { ServerConfig } from "./config.js";
import type { ConversationManager } from "./conversation-manager.js";

export interface AppContext {
  service: CopilotService;
  logger: Logger;
  config: ServerConfig;
  port: number;
  stats: Stats;
  // In auto mode, a shared manager is pre-created so MCP routes
  // only get registered once instead of per-provider
  toolBridgeManager?: ConversationManager | undefined;
}
