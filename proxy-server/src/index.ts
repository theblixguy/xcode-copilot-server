#!/usr/bin/env node
import { join, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { Command } from "commander";
import { Logger } from "./logger.js";
import { patcherByProxy } from "./settings-patcher/index.js";
import { parsePort, parseLogLevel, parseProxy, parseIdleTimeout, validateAutoPatch } from "./cli-validators.js";
import { startServer, type StartOptions } from "./startup.js";
import { installAgent, uninstallAgent } from "./launchd/index.js";

const PACKAGE_ROOT = dirname(import.meta.dirname);
const DEFAULT_CONFIG_PATH = join(PACKAGE_ROOT, "config.json5");

// Can't use a JSON import here because rootDir is src/ and package.json lives at the root
const { version } = z.object({ version: z.string() }).parse(
  JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf-8")),
);

interface PatchOptions {
  port: string;
  proxy: string;
  logLevel: string;
}

async function patchSettingsCommand(options: PatchOptions): Promise<void> {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  const port = parsePort(options.port);
  const proxy = parseProxy(options.proxy);

  const patcher = patcherByProxy[proxy];
  if (!patcher) {
    throw new Error(`No settings patcher for --proxy ${proxy}`);
  }
  await patcher.patch({ port, logger });
}

interface RestoreOptions {
  proxy: string;
  logLevel: string;
}

async function restoreSettingsCommand(options: RestoreOptions): Promise<void> {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  const proxy = parseProxy(options.proxy);

  const patcher = patcherByProxy[proxy];
  if (!patcher) {
    throw new Error(`No settings patcher for --proxy ${proxy}`);
  }
  await patcher.restore({ logger });
}

interface InstallAgentCliOptions {
  port: string;
  proxy: string;
  logLevel: string;
  idleTimeout: string;
  config?: string | undefined;
  cwd?: string | undefined;
  autoPatch?: true;
}

async function installAgentCommand(options: InstallAgentCliOptions): Promise<void> {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  const port = parsePort(options.port);
  const proxy = parseProxy(options.proxy);
  const idleTimeout = parseIdleTimeout(options.idleTimeout);

  if (options.autoPatch) {
    validateAutoPatch(proxy, true);
  }

  await installAgent({
    port,
    proxy,
    logLevel: options.logLevel,
    logger,
    config: options.config,
    cwd: options.cwd,
    autoPatch: options.autoPatch === true,
    idleTimeout,
  });
}

async function uninstallAgentCommand(options: { logLevel: string }): Promise<void> {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  await uninstallAgent({ logger });
}

const program = new Command()
  .name("xcode-copilot-server")
  .description("Proxy API server for Xcode, powered by GitHub Copilot")
  .version(version, "-v, --version")
  .enablePositionalOptions()
  .passThroughOptions();

program
  .option("-p, --port <number>", "port to listen on", "8080")
  .option("--proxy <provider>", "API format: openai, claude, codex", "openai")
  .option("-l, --log-level <level>", "log verbosity", "info")
  .option("-c, --config <path>", "path to config file")
  .option("--cwd <path>", "working directory for Copilot sessions")
  .option("--auto-patch", "auto-patch settings.json on start, restore on exit")
  .option("--idle-timeout <minutes>", "shut down after N minutes of inactivity", "0")
  .option("--launchd", "run in launchd mode (socket activation, no TTY output)")
  .action((options: StartOptions) => startServer({ ...options, version, defaultConfigPath: DEFAULT_CONFIG_PATH }));

program
  .command("patch-settings")
  .description("Patch settings to point to this server, then exit")
  .option("-p, --port <number>", "port to write into settings", "8080")
  .option("--proxy <provider>", "which provider to patch: claude, codex", "claude")
  .option("-l, --log-level <level>", "log verbosity", "info")
  .action((options: PatchOptions) => patchSettingsCommand(options));

program
  .command("restore-settings")
  .description("Restore settings from backup, then exit")
  .option("--proxy <provider>", "which provider to restore: claude, codex", "claude")
  .option("-l, --log-level <level>", "log verbosity", "info")
  .action((options: RestoreOptions) => restoreSettingsCommand(options));

program
  .command("install-agent")
  .description("Install a launchd agent with socket activation")
  .option("-p, --port <number>", "port to listen on", "8080")
  .option("--proxy <provider>", "API format: openai, claude, codex", "openai")
  .option("-l, --log-level <level>", "log verbosity for the agent", "info")
  .option("-c, --config <path>", "path to config file")
  .option("--cwd <path>", "working directory for Copilot sessions")
  .option("--auto-patch", "patch settings on install, restore on uninstall")
  .option("--idle-timeout <minutes>", "shut down agent after N minutes of inactivity", "60")
  .action((options: InstallAgentCliOptions) => installAgentCommand(options));

program
  .command("uninstall-agent")
  .description("Uninstall the launchd agent and restore settings")
  .option("-l, --log-level <level>", "log verbosity", "info")
  .action((options: { logLevel: string }) => uninstallAgentCommand(options));

program.parseAsync().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
