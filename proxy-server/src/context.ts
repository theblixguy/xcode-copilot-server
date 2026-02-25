import type { CopilotService, Logger, Stats } from "copilot-sdk-proxy";
import type { ServerConfig } from "./config.js";

export interface AppContext {
  service: CopilotService;
  logger: Logger;
  config: ServerConfig;
  port: number;
  stats: Stats;
}
