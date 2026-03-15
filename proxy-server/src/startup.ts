import {
  CopilotService,
  createServer,
  Logger,
  Stats,
  bold,
  dim,
  createSpinner,
  type LogLevel,
} from "copilot-sdk-proxy";
import type { AppContext } from "./context.js";
import {
  loadConfig,
  loadAllProviderConfigs,
  resolveConfigPath,
} from "./config.js";
import type { ServerConfig } from "./config-schema.js";
import type { AllProviderConfigs } from "./config.js";
import type { ProviderMode } from "copilot-sdk-proxy";
import { providers, createAutoProvider } from "./providers/index.js";
import type { Provider } from "./providers/types.js";
import { patchSettings } from "./settings-patcher/index.js";
import {
  parsePort,
  parseLogLevel,
  parseProviderMode,
  parseIdleTimeout,
  validateAutoPatch,
} from "./cli-validators.js";
import { activateSocket } from "./launchd/index.js";
import { printProxyBanner } from "./banner.js";
import { registerShutdownHandlers } from "./shutdown.js";

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

interface ParsedOptions {
  port: number;
  proxyMode: ProviderMode;
  logLevel: LogLevel;
  logger: Logger;
  quiet: boolean;
  launchdMode: boolean;
  shouldPatch: boolean;
  idleTimeoutMinutes: number;
  configPath: string;
  cwd: string | undefined;
}

function parseOptions(options: StartOptions): ParsedOptions {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  const port = parsePort(options.port);
  const proxyMode: ProviderMode = options.proxy
    ? parseProviderMode(options.proxy)
    : "auto";

  const idleTimeoutMinutes = options.idleTimeout
    ? parseIdleTimeout(options.idleTimeout)
    : 0;
  const launchdMode = options.launchd === true;
  const isAuto = proxyMode === "auto";
  const shouldPatch = isAuto
    ? !launchdMode
    : options.autoPatch === true && !launchdMode;
  if (!isAuto && !launchdMode) {
    validateAutoPatch(proxyMode, options.autoPatch === true);
  }

  const configPath =
    options.config ??
    resolveConfigPath(options.cwd, process.cwd(), options.defaultConfigPath);
  const quiet = logLevel === "none" || launchdMode;

  return {
    port,
    proxyMode,
    logLevel,
    logger,
    quiet,
    launchdMode,
    shouldPatch,
    idleTimeoutMinutes,
    configPath,
    cwd: options.cwd,
  };
}

async function loadProvider(parsed: ParsedOptions): Promise<{
  provider: Provider;
  config: ServerConfig;
  allConfigs?: AllProviderConfigs;
}> {
  const { proxyMode, configPath, logger } = parsed;
  if (proxyMode === "auto") {
    const allConfigs = await loadAllProviderConfigs(configPath, logger);
    return {
      provider: createAutoProvider(allConfigs.providers),
      config: allConfigs.shared,
      allConfigs,
    };
  }
  const config = await loadConfig(configPath, logger, proxyMode);
  return { provider: providers[proxyMode], config };
}

async function initializeService(
  parsed: ParsedOptions,
  version: string,
): Promise<CopilotService> {
  const { logLevel, logger, quiet, cwd } = parsed;

  const service = new CopilotService({ logLevel, logger, cwd });

  if (!quiet) {
    console.log();
    console.log(`  ${bold("xcode-copilot-server")} ${dim(`v${version}`)}`);
    console.log();
  }

  const bootSpinner = quiet
    ? null
    : createSpinner("Initialising Copilot SDK...");
  await service.start();
  bootSpinner?.succeed("Copilot SDK initialised");

  const authSpinner = quiet ? null : createSpinner("Authenticating...");
  const auth = await service.getAuthStatus();
  if (!auth.isAuthenticated) {
    authSpinner?.fail("Not authenticated");
    await service.stop();
    throw new Error(
      "Not authenticated. Sign in with the Copilot CLI (copilot login) or GitHub CLI (gh auth login), or set a GITHUB_TOKEN environment variable.",
    );
  }
  const login = auth.login ?? "unknown";
  const authType = auth.authType ?? "unknown";
  authSpinner?.succeed(
    `Authenticated as ${bold(login)} ${dim(`(${authType})`)}`,
  );

  return service;
}

async function bindAndListen(
  app: Awaited<ReturnType<typeof createServer>>,
  parsed: ParsedOptions,
): Promise<void> {
  const { port, quiet, launchdMode, logger } = parsed;

  const listenSpinner = quiet
    ? null
    : createSpinner(`Starting server on port ${String(port)}...`);
  const prevPinoLevel = app.log.level;
  app.log.level = "silent";

  if (launchdMode) {
    const fds = activateSocket("Listeners");
    const fd = fds[0];
    if (fd === undefined) {
      throw new Error("launch_activate_socket returned no file descriptors");
    }
    await app.listen({ fd });
    logger.info(
      `Listening via launchd socket activation (fd ${String(fd)}, port ${String(port)})`,
    );
  } else {
    // 127.0.0.1 binding is the auth boundary. Only local processes can reach the server.
    await app.listen({ port, host: "127.0.0.1" });
  }

  app.log.level = prevPinoLevel;
  listenSpinner?.succeed(
    `Listening on ${bold(`http://localhost:${String(port)}`)}`,
  );
}

function printBanner(
  parsed: ParsedOptions,
  provider: Provider,
  service: CopilotService,
  config: ServerConfig,
  allConfigs: AllProviderConfigs | undefined,
): void {
  const { proxyMode, shouldPatch, quiet, configPath, logger } = parsed;

  if (!quiet) {
    printProxyBanner({
      providerName: proxyMode === "auto" ? "Auto" : provider.name,
      proxyFlag: proxyMode === "auto" ? "auto" : proxyMode,
      routes: provider.routes,
      cwd: service.cwd,
      autoPatch: shouldPatch,
      logger,
    });
  }

  logger.debug(`Config loaded from ${configPath}`);
  const mcpCount = allConfigs
    ? new Set(
        Object.values(allConfigs.providers).flatMap((c) =>
          Object.keys(c.mcpServers),
        ),
      ).size
    : Object.keys(config.mcpServers).length;
  const cliToolsSummary = config.allowedCliTools.includes("*")
    ? "all CLI tools allowed"
    : `${String(config.allowedCliTools.length)} allowed CLI tool(s)`;
  logger.debug(`${String(mcpCount)} MCP server(s), ${cliToolsSummary}`);
}

export async function startServer(options: StartOptions): Promise<void> {
  const parsed = parseOptions(options);
  const { port, proxyMode, logger, shouldPatch, quiet } = parsed;

  const { provider, config, allConfigs } = await loadProvider(parsed);
  const service = await initializeService(parsed, options.version);

  if (shouldPatch) {
    const patchSpinner = quiet ? null : createSpinner("Patching settings...");
    try {
      await patchSettings(proxyMode, port, logger);
      patchSpinner?.succeed("Settings patched");
    } catch (err) {
      patchSpinner?.fail(`Failed to patch settings: ${String(err)}`);
      logger.warn(
        `Settings patching failed (continuing without patch): ${String(err)}`,
      );
    }
  }

  const stats = new Stats();
  const ctx: AppContext = { service, logger, config, port, stats };
  const app = await createServer(ctx, provider);

  let lastActivity = Date.now();
  app.addHook("onResponse", () => {
    lastActivity = Date.now();
  });

  await bindAndListen(app, parsed);
  printBanner(parsed, provider, service, config, allConfigs);

  registerShutdownHandlers({
    app,
    service,
    logger,
    stats,
    shouldPatch,
    proxyMode,
    quiet,
    lastActivityRef: () => lastActivity,
    idleTimeoutMinutes: parsed.idleTimeoutMinutes,
  });
}
