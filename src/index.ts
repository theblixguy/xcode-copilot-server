#!/usr/bin/env node
import { join, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { Command } from "commander";
import { Logger } from "./logger.js";
import { patcherByProxy } from "./settings-patcher/index.js";
import { parsePort, parseLogLevel, parseProxy } from "./cli-validators.js";
import { startServer, type StartOptions } from "./startup.js";

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

const program = new Command()
  .name("xcode-copilot-server")
  .description("Proxy API server for Xcode, powered by GitHub Copilot")
  .version(version, "-v, --version");

program
  .option("-p, --port <number>", "port to listen on", "8080")
  .option("--proxy <provider>", "API format: openai, claude, codex", "openai")
  .option("-l, --log-level <level>", "log verbosity", "info")
  .option("-c, --config <path>", "path to config file")
  .option("--cwd <path>", "working directory for Copilot sessions")
  .option("--auto-patch", "auto-patch settings.json on start, restore on exit")
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

program.parseAsync().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
