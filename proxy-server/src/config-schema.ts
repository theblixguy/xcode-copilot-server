import { z } from "zod";
import type { MCPServer, ReasoningEffort } from "copilot-sdk-proxy";
import {
  MCPServerSchema,
  ApprovalRuleSchema,
  ReasoningEffortSchema,
} from "copilot-sdk-proxy";

export type { MCPLocalServer } from "copilot-sdk-proxy";

export const BYTES_PER_MIB = 1024 * 1024;
export const MS_PER_MINUTE = 60_000;

const ProviderConfigSchema = z.object({
  toolBridge: z.boolean().optional().default(false),
  toolBridgeTimeout: z
    .number()
    .min(0, "toolBridgeTimeout must be >= 0")
    .default(0),
  mcpServers: z.record(z.string(), MCPServerSchema).default({}),
  reasoningEffort: ReasoningEffortSchema.optional(),
});

const providerDefaults = () => ({
  toolBridge: false,
  toolBridgeTimeout: 0,
  mcpServers: {},
});

export const ServerConfigSchema = z
  .object({
    claude: ProviderConfigSchema.default(providerDefaults),
    codex: ProviderConfigSchema.default(providerDefaults),
    openai: ProviderConfigSchema.default(providerDefaults),
    allowedCliTools: z
      .array(z.string())
      .refine(
        (arr) => !arr.includes("*") || arr.length === 1,
        'allowedCliTools: use ["*"] alone to allow all tools, don\'t mix with other entries',
      )
      .default([]),
    excludedFilePatterns: z.array(z.string()).default([]),
    bodyLimit: z
      .number()
      .positive()
      .max(100, "bodyLimit cannot exceed 100")
      .default(10),
    requestTimeout: z.number().min(0, "requestTimeout must be >= 0").default(0),
    autoApprovePermissions: ApprovalRuleSchema.default(["read", "mcp"]),
  })
  .strict();

type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

export type ServerConfig = {
  toolBridge: boolean;
  toolBridgeTimeoutMs: number;
  mcpServers: Record<string, MCPServer>;
  allowedCliTools: string[];
  excludedFilePatterns: string[];
  bodyLimit: number;
  requestTimeoutMs: number;
  autoApprovePermissions: ApprovalRule;
  reasoningEffort?: ReasoningEffort;
};

export const DEFAULT_CONFIG = {
  toolBridge: false,
  toolBridgeTimeoutMs: 0,
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 10 * BYTES_PER_MIB,
  requestTimeoutMs: 0,
  autoApprovePermissions: ["read", "mcp"],
} satisfies ServerConfig;
