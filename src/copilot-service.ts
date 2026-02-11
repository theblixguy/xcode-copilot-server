import {
  CopilotClient,
  type CopilotSession,
  type SessionConfig,
  type ModelInfo,
  type GetAuthStatusResponse,
} from "@github/copilot-sdk";
import type { LogLevel, Logger } from "./logger.js";

export interface CopilotServiceOptions {
  logLevel?: LogLevel | undefined;
  logger?: Logger | undefined;
  cwd?: string | undefined;
}

export class CopilotService {
  readonly cwd: string;
  private client: CopilotClient;
  private logger: Logger | undefined;

  constructor(options: CopilotServiceOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.logger = options.logger;
    this.client = new CopilotClient({
      logLevel: options.logLevel ?? "error",
      cwd: this.cwd,
      env: Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
      ),
    });
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async getAuthStatus(): Promise<GetAuthStatusResponse> {
    return this.client.getAuthStatus();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.client.listModels();
  }

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    this.logger?.info("Creating session");
    return this.client.createSession(config);
  }
}
