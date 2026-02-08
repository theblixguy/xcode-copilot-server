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
  private session: CopilotSession | null = null;
  private sessionPromise: Promise<CopilotSession> | null = null;
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
    if (this.session) {
      await this.session.destroy();
      this.session = null;
    }
    this.sessionPromise = null;
    await this.client.stop();
  }

  async getAuthStatus(): Promise<GetAuthStatusResponse> {
    return this.client.getAuthStatus();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.client.listModels();
  }

  async getSession(config: SessionConfig): Promise<CopilotSession> {
    if (this.session) {
      return this.session;
    }
    if (!this.sessionPromise) {
      this.sessionPromise = this.client.createSession(config).then(
        (s) => {
          this.session = s;
          this.sessionPromise = null;
          this.logger?.info("Session created");
          return s;
        },
        (err: unknown) => {
          this.sessionPromise = null;
          throw err;
        },
      );
    }
    return this.sessionPromise;
  }
}
