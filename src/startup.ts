import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CopilotService } from "./copilot-service.js";
import { loadConfig, resolveConfigPath } from "./config.js";
import { createServer } from "./server.js";
import { Logger } from "./logger.js";
import { providers, type ProxyName } from "./providers/index.js";
import type { AppContext } from "./context.js";
import { patcherByProxy } from "./settings-patcher/index.js";
import {
  parsePort,
  parseLogLevel,
  parseProxy,
  validateAutoPatch,
} from "./cli-validators.js";
import { bold, dim, createSpinner, printBanner } from "./ui.js";

const AGENTS_DIR = join(
  homedir(),
  "Library/Developer/Xcode/CodingAssistant/Agents/Versions",
);

const AGENT_BINARY_NAMES: Partial<Record<ProxyName, string>> = {
  claude: "claude",
  codex: "codex",
};

function findAgentBinary(proxy: ProxyName): string | null {
  const binaryName = AGENT_BINARY_NAMES[proxy];
  if (!binaryName) return null;

  if (!existsSync(AGENTS_DIR)) return null;

  let versions: string[];
  try {
    versions = readdirSync(AGENTS_DIR);
  } catch {
    return null;
  }

  for (const version of versions) {
    const binaryPath = join(AGENTS_DIR, version, binaryName);
    if (existsSync(binaryPath)) return binaryPath;
  }
  return null;
}

export interface StartOptions {
  port: string;
  proxy: string;
  logLevel: string;
  version: string;
  defaultConfigPath: string;
  config?: string;
  cwd?: string;
  autoPatch?: true;
}

export async function startServer(options: StartOptions): Promise<void> {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  const port = parsePort(options.port);
  const proxy = parseProxy(options.proxy);

  const autoPatch = options.autoPatch === true;
  validateAutoPatch(proxy, autoPatch);

  const provider = providers[proxy];

  const configPath = options.config ?? resolveConfigPath(options.cwd, process.cwd(), options.defaultConfigPath);
  const config = await loadConfig(configPath, logger, proxy);
  const cwd = options.cwd;

  const service = new CopilotService({
    logLevel,
    logger,
    cwd,
  });

  const quiet = logLevel === "none";

  if (!quiet) {
    console.log();
    console.log(`  ${bold("xcode-copilot-server")} ${dim(`v${options.version}`)}`);
    console.log();
  }

  const bootSpinner = quiet ? null : createSpinner("Initialising Copilot SDK...");
  await service.start();
  bootSpinner?.succeed("Copilot SDK initialised");

  const authSpinner = quiet ? null : createSpinner("Authenticating...");
  const auth = await service.getAuthStatus();
  if (!auth.isAuthenticated) {
    authSpinner?.fail("Not authenticated");
    logger.error(
      "Sign in with the Copilot CLI (copilot login) or GitHub CLI (gh auth login), or set a GITHUB_TOKEN environment variable.",
    );
    await service.stop();
    process.exit(1);
  }
  const login = auth.login ?? "unknown";
  const authType = auth.authType ?? "unknown";
  authSpinner?.succeed(`Authenticated as ${bold(login)} ${dim(`(${authType})`)}`);

  if (autoPatch) {
    const patcher = patcherByProxy[proxy];
    if (patcher) {
      const patchSpinner = quiet ? null : createSpinner("Patching settings...");
      try {
        await patcher.patch({ port, logger });
        patchSpinner?.succeed("Settings patched");
      } catch (err) {
        patchSpinner?.fail(`Failed to patch settings: ${String(err)}`);
      }
    }
  }

  const ctx: AppContext = { service, logger, config, port };
  const app = await createServer(ctx, provider);
  const listenSpinner = quiet ? null : createSpinner(`Starting server on port ${String(port)}...`);
  const prevPinoLevel = app.log.level;
  app.log.level = "silent";
  await app.listen({ port, host: "127.0.0.1" });
  app.log.level = prevPinoLevel;
  listenSpinner?.succeed(`Listening on ${bold(`http://localhost:${String(port)}`)}`);

  if (!quiet) {
    const binaryName = AGENT_BINARY_NAMES[proxy];
    const bannerBase = {
      port,
      proxy,
      providerName: provider.name,
      routes: provider.routes,
      cwd: service.cwd,
      autoPatch,
    };

    if (binaryName) {
      const agentPath = findAgentBinary(proxy);
      const agentBinary = agentPath
        ? { found: true as const, path: agentPath }
        : { found: false as const, expected: `${AGENTS_DIR}/<version>/${binaryName}` };
      printBanner({ ...bannerBase, agentBinary });
    } else {
      printBanner(bannerBase);
    }
  }

  logger.debug(`Config loaded from ${configPath}`);
  const mcpCount = Object.keys(config.mcpServers).length;
  const cliToolsSummary = config.allowedCliTools.includes("*")
    ? "all CLI tools allowed"
    : `${String(config.allowedCliTools.length)} allowed CLI tool(s)`;
  logger.debug(`${String(mcpCount)} MCP server(s), ${cliToolsSummary}`);

  const shutdown = async (signal: string) => {
    logger.info(`Got ${signal}, shutting down...`);

    if (autoPatch) {
      const patcher = patcherByProxy[proxy];
      if (patcher) {
        try {
          await patcher.restore({ logger });
        } catch (err) {
          logger.error(`Failed to restore settings: ${String(err)}`);
        }
      }
    }

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

  const onSignal = (signal: string) => {
    shutdown(signal).catch((err: unknown) => {
      console.error("Shutdown error:", err);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => { onSignal("SIGINT"); });
  process.on("SIGTERM", () => { onSignal("SIGTERM"); });
}
