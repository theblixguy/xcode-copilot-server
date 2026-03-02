import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  CopilotService,
  createServer,
  Logger,
  Stats,
  bold, dim, createSpinner, printUsageSummary,
} from "copilot-sdk-proxy";
import type { AppContext } from "./context.js";
import { loadConfig, loadAllProviderConfigs, resolveConfigPath, type ServerConfig, type AllProviderConfigs } from "./config.js";
import { providers, createAutoProvider, type ProxyName, type ProxyMode } from "./providers/index.js";
import type { Provider } from "./providers/types.js";
import { patchSettings, restoreSettings } from "./settings-patcher/index.js";
import {
  parsePort,
  parseLogLevel,
  parseProxyMode,
  parseIdleTimeout,
  validateAutoPatch,
} from "./cli-validators.js";
import { activateSocket } from "./launchd/index.js";
import { printProxyBanner } from "./banner.js";

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
  proxy?: string;
  logLevel: string;
  version: string;
  defaultConfigPath: string;
  config?: string;
  cwd?: string;
  autoPatch?: true;
  launchd?: true;
  idleTimeout?: string;
}

export async function startServer(options: StartOptions): Promise<void> {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  const port = parsePort(options.port);
  const proxyMode: ProxyMode = options.proxy ? parseProxyMode(options.proxy) : "auto";

  const idleTimeoutMinutes = options.idleTimeout ? parseIdleTimeout(options.idleTimeout) : 0;
  const launchdMode = options.launchd === true;
  const isAuto = proxyMode === "auto";
  const shouldPatch = isAuto
    ? !launchdMode
    : options.autoPatch === true && !launchdMode;
  if (!isAuto && !launchdMode) {
    validateAutoPatch(proxyMode, options.autoPatch === true);
  }

  const configPath = options.config ?? resolveConfigPath(options.cwd, process.cwd(), options.defaultConfigPath);
  const cwd = options.cwd;

  let provider: Provider;
  let config: ServerConfig;
  let allConfigs: AllProviderConfigs | undefined;
  if (isAuto) {
    allConfigs = await loadAllProviderConfigs(configPath, logger);
    provider = createAutoProvider(allConfigs.providers);
    config = allConfigs.shared;
  } else {
    config = await loadConfig(configPath, logger, proxyMode);
    provider = providers[proxyMode];
  }

  const service = new CopilotService({
    logLevel,
    logger,
    cwd,
  });

  const quiet = logLevel === "none" || launchdMode;

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

  if (shouldPatch) {
    const patchSpinner = quiet ? null : createSpinner("Patching settings...");
    try {
      await patchSettings(proxyMode, port, logger);
      patchSpinner?.succeed("Settings patched");
    } catch (err) {
      patchSpinner?.fail(`Failed to patch settings: ${String(err)}`);
    }
  }

  const stats = new Stats();
  const ctx: AppContext = { service, logger, config, port, stats };
  const app = await createServer(ctx, provider);

  // Must register hooks before listen() because Fastify freezes the instance after that
  let lastActivity = Date.now();
  app.addHook("onResponse", () => {
    lastActivity = Date.now();
  });

  const listenSpinner = quiet ? null : createSpinner(`Starting server on port ${String(port)}...`);
  const prevPinoLevel = app.log.level;
  app.log.level = "silent";

  if (launchdMode) {
    const fds = activateSocket("Listeners");
    const fd = fds[0];
    if (fd === undefined) {
      throw new Error("launch_activate_socket returned no file descriptors");
    }
    // TODO: Remove cast when Fastify types add fd support
    // @ts-expect-error Fastify supports listen({ fd }) at runtime but the types don't include it yet
    await app.listen({ fd });
    logger.info(`Listening via launchd socket activation (fd ${String(fd)}, port ${String(port)})`);
  } else {
    await app.listen({ port, host: "127.0.0.1" });
  }

  app.log.level = prevPinoLevel;
  listenSpinner?.succeed(`Listening on ${bold(`http://localhost:${String(port)}`)}`);

  if (!quiet) {
    if (isAuto) {
      printProxyBanner({
        providerName: "Auto",
        proxyFlag: "auto",
        routes: provider.routes,
        cwd: service.cwd,
        autoPatch: shouldPatch,
      });
    } else {
      const binaryName = AGENT_BINARY_NAMES[proxyMode];
      printProxyBanner({
        providerName: provider.name,
        proxyFlag: proxyMode,
        routes: provider.routes,
        cwd: service.cwd,
        autoPatch: shouldPatch,
        agentPath: binaryName ? findAgentBinary(proxyMode) : undefined,
        agentBinaryName: binaryName,
        agentsDir: AGENTS_DIR,
      });
    }
  }

  logger.debug(`Config loaded from ${configPath}`);
  const mcpCount = allConfigs
    ? new Set(Object.values(allConfigs.providers).flatMap((c) => Object.keys(c.mcpServers))).size
    : Object.keys(config.mcpServers).length;
  const cliToolsSummary = config.allowedCliTools.includes("*")
    ? "all CLI tools allowed"
    : `${String(config.allowedCliTools.length)} allowed CLI tool(s)`;
  logger.debug(`${String(mcpCount)} MCP server(s), ${cliToolsSummary}`);

  const shutdown = async (signal: string) => {
    // Suppress errors from writes to already-closed pipes during teardown
    process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
      logger.debug(`Ignoring error during shutdown: ${err.message}`);
    });

    logger.info(`Got ${signal}, shutting down...`);

    if (shouldPatch) {
      await restoreSettings(proxyMode, logger);
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

    if (!quiet) {
      printUsageSummary(stats.snapshot());
    }

    process.exit(0);
  };

  let shuttingDown = false;
  const onSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown(signal).catch((err: unknown) => {
      console.error("Shutdown error:", err);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => { onSignal("SIGINT"); });
  process.on("SIGTERM", () => { onSignal("SIGTERM"); });

  if (idleTimeoutMinutes > 0) {
    const idleMs = idleTimeoutMinutes * 60_000;

    const checkInterval = Math.min(idleMs, 60_000);
    const timer = setInterval(() => {
      if (Date.now() - lastActivity >= idleMs) {
        clearInterval(timer);
        logger.info(`Idle for ${String(idleTimeoutMinutes)} minute(s), shutting down`);
        onSignal("idle-timeout");
      }
    }, checkInterval);

    // Don't let the timer alone keep the process alive
    timer.unref();
  }
}
