import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import plist, { type PlistObject } from "plist";
import type { Logger } from "copilot-sdk-proxy";
import type { ProviderMode } from "copilot-sdk-proxy";
import { isProviderName } from "../cli-validators.js";
import { patchSettings, restoreSettings } from "../settings-patcher/index.js";
import { defaultExec, type ExecFn } from "../utils/child-process.js";
import { isRecord } from "../utils/type-guards.js";

export const AGENT_LABEL = "com.xcode-copilot-server";

function defaultPlistPath(): string {
  return join(homedir(), "Library/LaunchAgents", `${AGENT_LABEL}.plist`);
}

function defaultLogPaths(): { out: string; err: string } {
  const dir = join(homedir(), "Library/Logs");
  return {
    out: join(dir, "xcode-copilot-server.out.log"),
    err: join(dir, "xcode-copilot-server.err.log"),
  };
}

export interface PlistOptions {
  nodePath: string;
  entryPoint: string;
  port: number;
  proxy: ProviderMode;
  logLevel: string;
  config?: string | undefined;
  cwd?: string | undefined;
  autoPatch?: boolean | undefined;
  idleTimeout?: number | undefined;
  environmentVariables?: Record<string, string> | undefined;
  logPaths?: { out: string; err: string } | undefined;
}

export function generatePlist(options: PlistOptions): string {
  const args: string[] = [
    options.nodePath,
    options.entryPoint,
    "--launchd",
    "--port",
    String(options.port),
    "--log-level",
    options.logLevel,
  ];

  if (options.proxy !== "auto") {
    args.push("--proxy", options.proxy);
  }

  if (options.config) {
    args.push("--config", options.config);
  }
  if (options.cwd) {
    args.push("--cwd", options.cwd);
  }
  if (options.autoPatch) {
    args.push("--auto-patch");
  }
  if (options.idleTimeout !== undefined && options.idleTimeout > 0) {
    args.push("--idle-timeout", String(options.idleTimeout));
  }

  const logPaths = options.logPaths ?? defaultLogPaths();

  const envVars: Record<string, string> = { ...options.environmentVariables };
  if (!envVars["PATH"] && process.env["PATH"]) {
    envVars["PATH"] = process.env["PATH"];
  }
  // GITHUB_TOKEN is written in cleartext into the plist so the agent can authenticate.
  // The file lives in ~/Library/LaunchAgents/ which is user-readable only by default.
  if (!envVars["GITHUB_TOKEN"] && process.env["GITHUB_TOKEN"]) {
    envVars["GITHUB_TOKEN"] = process.env["GITHUB_TOKEN"];
  }

  const hasEnv = Object.keys(envVars).length > 0;

  const obj: PlistObject = {
    Label: AGENT_LABEL,
    ProgramArguments: args,
    Sockets: {
      Listeners: {
        SockServiceName: String(options.port),
        SockNodeName: "127.0.0.1",
        SockFamily: "IPv4",
        SockType: "stream",
      },
    },
    StandardOutPath: logPaths.out,
    StandardErrorPath: logPaths.err,
    ...(hasEnv ? { EnvironmentVariables: envVars } : {}),
  };

  return plist.build(obj) + "\n";
}

interface ParsedPlistArgs {
  proxy: ProviderMode | null;
  autoPatch: boolean;
}

export function parsePlistArgs(plistContent: string): ParsedPlistArgs {
  let raw: unknown;
  try {
    raw = plist.parse(plistContent);
  } catch {
    // Malformed plist, fall back to safe defaults
    return { proxy: null, autoPatch: false };
  }

  if (!isRecord(raw)) {
    return { proxy: null, autoPatch: false };
  }

  const parsed = raw;
  const args = parsed["ProgramArguments"];
  if (!Array.isArray(args)) {
    return { proxy: null, autoPatch: false };
  }

  const flagArgs = args
    .slice(2)
    .filter((a): a is string => typeof a === "string");

  const cmd = new Command()
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .option("--proxy <provider>")
    .option("--auto-patch")
    .allowUnknownOption()
    .allowExcessArguments();

  try {
    cmd.parse(flagArgs, { from: "user" });
  } catch {
    // Unparsable flags, fall back to safe defaults
    return { proxy: null, autoPatch: false };
  }

  const opts = cmd.opts<{ proxy?: string; autoPatch?: true }>();
  let proxy: ProviderMode | null;
  if (opts.proxy && isProviderName(opts.proxy)) {
    proxy = opts.proxy;
  } else if (opts.proxy === undefined) {
    // Omitting --proxy is how auto mode plists are generated
    proxy = "auto";
  } else {
    proxy = null;
  }

  return { proxy, autoPatch: opts.autoPatch === true || proxy === "auto" };
}

interface InstallAgentOptions {
  port: number;
  proxy: ProviderMode;
  logLevel: string;
  logger: Logger;
  config?: string | undefined;
  cwd?: string | undefined;
  autoPatch?: boolean | undefined;
  idleTimeout?: number | undefined;
  exec?: ExecFn | undefined;
  plistPath?: string | undefined;
  nodePath?: string | undefined;
  entryPoint?: string | undefined;
}

export async function installAgent(
  options: InstallAgentOptions,
): Promise<void> {
  const {
    port,
    proxy,
    logLevel,
    logger,
    autoPatch = proxy === "auto",
  } = options;
  const exec = options.exec ?? defaultExec;
  const plistPath = options.plistPath ?? defaultPlistPath();
  const nodePath = options.nodePath ?? process.execPath;
  // import.meta.dirname at runtime is dist/launchd/, so go up two levels to the package root
  const entryPoint =
    options.entryPoint ??
    resolve(dirname(dirname(import.meta.dirname)), "dist/index.js");

  if (existsSync(plistPath)) {
    try {
      await exec("launchctl", ["unload", plistPath]);
    } catch (err) {
      logger.debug(`launchctl unload skipped: ${String(err)}`);
    }
  }

  const plistXml = generatePlist({
    nodePath,
    entryPoint,
    port,
    proxy,
    logLevel,
    config: options.config,
    cwd: options.cwd,
    autoPatch,
    idleTimeout: options.idleTimeout,
  });

  await mkdir(dirname(plistPath), { recursive: true });
  await writeFile(plistPath, plistXml, "utf-8");
  await exec("launchctl", ["load", plistPath]);

  if (autoPatch) {
    await patchSettings(proxy, port, logger);
  }

  const logPaths = defaultLogPaths();
  logger.info(`Launchd agent installed: ${AGENT_LABEL}`);
  logger.info(`  Port: ${String(port)}, Proxy: ${proxy}`);
  logger.info(`  Plist: ${plistPath}`);
  logger.info(`  Logs: ${logPaths.out}`);
}

interface UninstallAgentOptions {
  logger: Logger;
  exec?: ExecFn | undefined;
  plistPath?: string | undefined;
}

export async function uninstallAgent(
  options: UninstallAgentOptions,
): Promise<void> {
  const { logger } = options;
  const exec = options.exec ?? defaultExec;
  const plistPath = options.plistPath ?? defaultPlistPath();

  if (!existsSync(plistPath)) {
    throw new Error(`No launchd agent found at ${plistPath}`);
  }

  // Read config before deleting so we know whether to restore settings.
  // If the file is unreadable (e.g. permissions), default so uninstall can still proceed.
  let parsed: ParsedPlistArgs;
  try {
    const plistContent = await readFile(plistPath, "utf-8");
    parsed = parsePlistArgs(plistContent);
  } catch (err) {
    logger.warn(
      `Could not read plist, skipping settings restore: ${String(err)}`,
    );
    parsed = { proxy: null, autoPatch: false };
  }

  try {
    await exec("launchctl", ["unload", plistPath]);
  } catch (err) {
    logger.warn(`launchctl unload failed: ${String(err)}`);
  }

  try {
    await unlink(plistPath);
  } catch (err) {
    logger.warn(`Failed to remove plist file: ${String(err)}`);
  }

  if (parsed.autoPatch) {
    await restoreSettings(parsed.proxy, logger);
  }

  logger.info(`Launchd agent uninstalled: ${AGENT_LABEL}`);
}
