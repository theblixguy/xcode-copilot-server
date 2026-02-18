import type { CopilotService } from "./copilot-service.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { Stats } from "./stats.js";

export interface AppContext {
  service: CopilotService;
  logger: Logger;
  config: ServerConfig;
  port: number;
  stats: Stats;
}
