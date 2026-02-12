#!/usr/bin/env node
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { CopilotService } from "./copilot-service.js";
import { loadConfig, resolveConfigPath } from "./config.js";
import { createServer } from "./server.js";
import { Logger, LEVEL_PRIORITY, type LogLevel } from "./logger.js";
import { providers, type ProxyName } from "./providers/index.js";
import type { AppContext } from "./context.js";

const PACKAGE_ROOT = dirname(import.meta.dirname);
const DEFAULT_CONFIG_PATH = join(PACKAGE_ROOT, "config.json5");

const VALID_LOG_LEVELS = Object.keys(LEVEL_PRIORITY) as LogLevel[];
const VALID_PROXIES = Object.keys(providers);

function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_PRIORITY;
}

function isProxy(value: string): value is ProxyName {
  return value in providers;
}

const USAGE = `Usage: xcode-copilot-server [options]

Options:
  --port <number>      Port to listen on (default: 8080)
  --proxy <provider>   API format to expose: ${VALID_PROXIES.join(", ")} (default: openai)
  --log-level <level>  Log verbosity: ${VALID_LOG_LEVELS.join(", ")} (default: info)
  --config <path>      Path to config file (auto-detected from --cwd, then process cwd, else bundled)
  --cwd <path>         Working directory for Copilot sessions (default: process cwd)
  --help               Show this help message`;

function parseCliArgs() {
  try {
    return parseArgs({
      options: {
        port: { type: "string", default: "8080" },
        proxy: { type: "string", default: "openai" },
        "log-level": { type: "string", default: "info" },
        config: { type: "string" },
        cwd: { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    console.error(`Run with --help for usage information.`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { values } = parseCliArgs();

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const port = parseInt(values.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Invalid port "${values.port}". Must be 1-65535.`);
    process.exit(1);
  }

  const proxy = values.proxy;
  if (!isProxy(proxy)) {
    console.error(
      `Invalid proxy "${proxy}". Valid: ${VALID_PROXIES.join(", ")}`,
    );
    process.exit(1);
  }
  const provider = providers[proxy];

  const rawLevel = values["log-level"];
  if (!isLogLevel(rawLevel)) {
    console.error(
      `Invalid log level "${rawLevel}". Valid: ${VALID_LOG_LEVELS.join(", ")}`,
    );
    process.exit(1);
  }
  const logLevel = rawLevel;
  const logger = new Logger(logLevel);

  const configPath = values.config ?? resolveConfigPath(values.cwd, process.cwd(), DEFAULT_CONFIG_PATH);
  const config = await loadConfig(configPath, logger, proxy);
  const cwd = values.cwd;

  const service = new CopilotService({
    logLevel,
    logger,
    cwd,
  });

  logger.info("Booting up Copilot CLI...");
  await service.start();
  logger.info("Copilot CLI is up");

  const auth = await service.getAuthStatus();
  if (!auth.isAuthenticated) {
    logger.error(
      "Not authenticated. Sign in with the Copilot CLI (copilot login) or GitHub CLI (gh auth login), or set a GITHUB_TOKEN environment variable.",
    );
    await service.stop();
    process.exit(1);
  }
  logger.info(`Authenticated as ${auth.login ?? "unknown"} (${auth.authType ?? "unknown"})`);

  const ctx: AppContext = { service, logger, config, port };
  const app = await createServer(ctx, provider);
  await app.listen({ port, host: "127.0.0.1" });

  logger.info(`Listening on http://localhost:${String(port)}`);
  logger.info(`Provider: ${provider.name} (--proxy ${proxy})`);
  logger.info(`Routes: ${provider.routes.join(", ")}`);
  logger.info(`Current working directory: ${service.cwd}`);

  const shutdown = async (signal: string) => {
    logger.info(`Got ${signal}, shutting down...`);
    await app.close();

    const stopPromise = service.stop().then(() => {
      logger.info("Clean shutdown complete");
    });
    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.warn("Copilot client didn't stop in time, forcing exit");
        resolve();
      }, 3000),
    );

    await Promise.race([stopPromise, timeoutPromise]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
