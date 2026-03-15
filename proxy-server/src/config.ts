// resolveConfigPath is sync (runs once at startup). The loaders are async because they read disk.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import type { Logger, MCPServer } from "copilot-sdk-proxy";
import type { ProviderName } from "copilot-sdk-proxy";
import {
  ServerConfigSchema,
  DEFAULT_CONFIG,
  BYTES_PER_MIB,
  MS_PER_MINUTE,
} from "./config-schema.js";
import type { ServerConfig } from "./config-schema.js";
import { isErrnoException } from "./utils/type-guards.js";

function resolveServerPaths(
  servers: Record<string, MCPServer>,
  configDir: string,
): Record<string, MCPServer> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      name,
      "args" in server
        ? {
            ...server,
            args: server.args.map((arg) =>
              arg.startsWith("./") || arg.startsWith("../")
                ? resolve(configDir, arg)
                : arg,
            ),
          }
        : server,
    ]),
  );
}

export function resolveConfigPath(
  projectCwd: string | undefined,
  processCwd: string,
  defaultPath: string,
): string {
  if (projectCwd) {
    const projectConfig = resolve(projectCwd, "config.json5");
    if (existsSync(projectConfig)) return projectConfig;
  }
  const localConfig = resolve(processCwd, "config.json5");
  if (existsSync(localConfig)) return localConfig;
  return defaultPath;
}

type ParsedConfig = {
  data: z.infer<typeof ServerConfigSchema>;
  configDir: string;
};

async function parseConfigFile(
  configPath: string,
  logger: Logger,
): Promise<ParsedConfig | null> {
  const absolutePath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  let text: string;
  try {
    text = await readFile(absolutePath, "utf-8");
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      logger.warn(`No config file at ${absolutePath}, using defaults`);
      return null;
    }
    throw new Error(
      `Failed to read config file at ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  let raw: unknown;
  try {
    raw = JSON5.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse config file: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Config file must contain a JSON5 object");
  }

  const parseResult = ServerConfigSchema.safeParse(raw);
  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0];
    if (!firstError) {
      throw new Error("Invalid config: validation failed");
    }
    const path = firstError.path.join(".");
    throw new Error(
      `Invalid config${path ? ` at "${path}"` : ""}: ${firstError.message}`,
    );
  }

  return { data: parseResult.data, configDir: dirname(absolutePath) };
}

function buildServerConfig(
  parsed: z.infer<typeof ServerConfigSchema>,
  configDir: string,
  proxy: ProviderName,
): ServerConfig {
  const provider = parsed[proxy];
  return {
    allowedCliTools: parsed.allowedCliTools,
    excludedFilePatterns: parsed.excludedFilePatterns,
    autoApprovePermissions: parsed.autoApprovePermissions,
    reasoningEffort: parsed.reasoningEffort,
    bodyLimit: parsed.bodyLimit * BYTES_PER_MIB,
    requestTimeoutMs: parsed.requestTimeout * MS_PER_MINUTE,
    toolBridge: provider.toolBridge,
    toolBridgeTimeoutMs: provider.toolBridgeTimeout * MS_PER_MINUTE,
    mcpServers: resolveServerPaths(provider.mcpServers, configDir),
  };
}

export async function loadConfig(
  configPath: string,
  logger: Logger,
  proxy: ProviderName,
): Promise<ServerConfig> {
  const result = await parseConfigFile(configPath, logger);
  if (!result) return DEFAULT_CONFIG;
  return buildServerConfig(result.data, result.configDir, proxy);
}

export type AllProviderConfigs = {
  providers: Record<ProviderName, ServerConfig>;
  shared: ServerConfig;
};

export async function loadAllProviderConfigs(
  configPath: string,
  logger: Logger,
): Promise<AllProviderConfigs> {
  const result = await parseConfigFile(configPath, logger);
  const providers: Record<ProviderName, ServerConfig> = {
    openai: result
      ? buildServerConfig(result.data, result.configDir, "openai")
      : DEFAULT_CONFIG,
    claude: result
      ? buildServerConfig(result.data, result.configDir, "claude")
      : DEFAULT_CONFIG,
    codex: result
      ? buildServerConfig(result.data, result.configDir, "codex")
      : DEFAULT_CONFIG,
  };
  // Common fields only, no per-provider toolBridge / mcpServers.
  const shared: ServerConfig = result
    ? {
        allowedCliTools: result.data.allowedCliTools,
        excludedFilePatterns: result.data.excludedFilePatterns,
        autoApprovePermissions: result.data.autoApprovePermissions,
        reasoningEffort: result.data.reasoningEffort,
        bodyLimit: result.data.bodyLimit * BYTES_PER_MIB,
        requestTimeoutMs: result.data.requestTimeout * MS_PER_MINUTE,
        toolBridge: false,
        toolBridgeTimeoutMs: 0,
        mcpServers: {},
      }
    : DEFAULT_CONFIG;
  return { providers, shared };
}
