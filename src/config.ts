import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import JSON5 from "json5";
import type { Logger } from "./logger.js";
import type { ProxyName } from "./providers/index.js";
import {
  ServerConfigSchema,
  type MCPServer,
  type RawServerConfig,
} from "./schemas/config.js";

export type {
  MCPLocalServer,
  MCPRemoteServer,
  MCPServer,
  ApprovalRule,
  ReasoningEffort,
} from "./schemas/config.js";
export type { ProxyName };

export type ServerConfig = Omit<RawServerConfig, "bodyLimitMiB" | "openai" | "claude" | "codex"> & {
  toolBridge: boolean;
  mcpServers: Record<string, MCPServer>;
  bodyLimit: number;
};

const DEFAULT_CONFIG = {
  toolBridge: false,
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 10 * 1024 * 1024,
  autoApprovePermissions: ["read", "mcp"],
} satisfies ServerConfig;

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

export async function loadConfig(
  configPath: string,
  logger: Logger,
  proxy: ProxyName,
): Promise<ServerConfig> {
  const absolutePath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  let text: string;
  try {
    text = await readFile(absolutePath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn(`No config file at ${absolutePath}, using defaults`);
      return DEFAULT_CONFIG;
    }
    throw err;
  }

  let raw: unknown;
  try {
    raw = JSON5.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse config file: ${err instanceof Error ? err.message : String(err)}`,
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
      `Invalid config${path ? ` at "${path}"` : ""}: ${firstError.message}`
    );
  }

  const configDir = dirname(absolutePath);
  const parsed = parseResult.data;
  const provider = parsed[proxy];
  const config: ServerConfig = {
    allowedCliTools: parsed.allowedCliTools,
    excludedFilePatterns: parsed.excludedFilePatterns,
    autoApprovePermissions: parsed.autoApprovePermissions,
    reasoningEffort: parsed.reasoningEffort,
    bodyLimit: parsed.bodyLimitMiB * 1024 * 1024,
    toolBridge: provider.toolBridge,
    mcpServers: resolveServerPaths(provider.mcpServers, configDir),
  };

  return config;
}
