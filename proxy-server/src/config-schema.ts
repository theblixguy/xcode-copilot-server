import { z } from "zod";
import type { MCPServer } from "copilot-sdk-proxy";

export type { MCPLocalServer } from "copilot-sdk-proxy";

export const BYTES_PER_MIB = 1024 * 1024;

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

export const ServerConfigSchema = z.object({
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

export const DEFAULT_CONFIG = {
  toolBridge: false,
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 10 * BYTES_PER_MIB,
  autoApprovePermissions: ["read", "mcp"],
} satisfies ServerConfig;
