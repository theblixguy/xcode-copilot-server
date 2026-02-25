import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import type { Logger, MCPServer } from "copilot-sdk-proxy";

export type {
  MCPLocalServer,
  MCPRemoteServer,
  MCPServer,
  ApprovalRule,
  ReasoningEffort,
} from "copilot-sdk-proxy";

import type { ProxyName } from "./providers/index.js";
export type { ProxyName };

// Xcode config schema, extends core with per-provider toolBridge + mcpServers
const MCPLocalServerSchema = z.object({
  type: z.union([z.literal("local"), z.literal("stdio")]),
  command: z.string().min(1, "MCP server command cannot be empty"),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

const MCPRemoteServerSchema = z.object({
  type: z.union([z.literal("http"), z.literal("sse")]),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

const MCPServerSchema = z.union([MCPLocalServerSchema, MCPRemoteServerSchema]);

const VALID_PERMISSION_KINDS = ["read", "write", "shell", "mcp", "url"] as const;
const ApprovalRuleSchema = z.union([
  z.boolean(),
  z.array(z.enum(VALID_PERMISSION_KINDS)),
]);

const VALID_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const ReasoningEffortSchema = z.enum(VALID_REASONING_EFFORTS);

const ProviderConfigSchema = z.object({
  toolBridge: z.boolean().optional().default(false),
  mcpServers: z.record(z.string(), MCPServerSchema).default({}),
});

const ServerConfigSchema = z.object({
  openai: ProviderConfigSchema.default({ toolBridge: false, mcpServers: {} }),
  claude: ProviderConfigSchema.default({ toolBridge: false, mcpServers: {} }),
  codex: ProviderConfigSchema.default({ toolBridge: false, mcpServers: {} }),
  allowedCliTools: z.array(z.string()).refine(
    (arr) => !arr.includes("*") || arr.length === 1,
    'allowedCliTools: use ["*"] alone to allow all tools, don\'t mix with other entries',
  ).default([]),
  excludedFilePatterns: z.array(z.string()).default([]),
  bodyLimitMiB: z
    .number()
    .positive()
    .max(100, "bodyLimitMiB cannot exceed 100")
    .default(10),
  reasoningEffort: ReasoningEffortSchema.optional(),
  autoApprovePermissions: ApprovalRuleSchema.default(["read", "mcp"]),
});

type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

export type ServerConfig = {
  toolBridge: boolean;
  mcpServers: Record<string, MCPServer>;
  allowedCliTools: string[];
  excludedFilePatterns: string[];
  bodyLimit: number;
  autoApprovePermissions: ApprovalRule;
  reasoningEffort?: z.infer<typeof ReasoningEffortSchema> | undefined;
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
