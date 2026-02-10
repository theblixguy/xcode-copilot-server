import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import JSON5 from "json5";
import type { Logger } from "./logger.js";
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

export type ServerConfig = Omit<RawServerConfig, "bodyLimitMiB"> & {
  bodyLimit: number;
};

const DEFAULT_CONFIG: ServerConfig = {
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 4 * 1024 * 1024, // 4 MiB
  autoApprovePermissions: ["read", "mcp"],
};

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

export async function loadConfig(
  configPath: string,
  logger: Logger,
): Promise<ServerConfig> {
  const absolutePath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  if (!existsSync(absolutePath)) {
    logger.warn(`No config file at ${absolutePath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  logger.info(`Reading config from ${absolutePath}`);

  const text = await readFile(absolutePath, "utf-8");
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

  const { bodyLimitMiB, ...rest } = parseResult.data;
  const config: ServerConfig = {
    ...rest,
    bodyLimit: bodyLimitMiB * 1024 * 1024,
    mcpServers: resolveServerPaths(
      parseResult.data.mcpServers,
      dirname(absolutePath),
    ),
  };

  const cliToolsSummary = config.allowedCliTools.includes("*")
    ? "all CLI tools allowed"
    : `${String(config.allowedCliTools.length)} allowed CLI tool(s)`;
  logger.info(
    `Loaded ${String(Object.keys(config.mcpServers).length)} MCP server(s), ${cliToolsSummary}`,
  );

  return config;
}
