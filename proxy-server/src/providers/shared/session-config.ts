import type {
  SessionConfig,
  Logger,
  SessionConfigOptions as BaseSessionConfigOptions,
} from "copilot-sdk-proxy";
import { createSessionConfig as createBaseSessionConfig } from "copilot-sdk-proxy";
import type { ServerConfig } from "../../config-schema.js";
import {
  BRIDGE_SERVER_NAME,
  BRIDGE_TOOL_PREFIX,
} from "../../tool-bridge/bridge-constants.js";

const SDK_BUILT_IN_TOOLS: string[] = [
  // shell
  "bash",
  "write_bash",
  "read_bash",
  "stop_bash",
  "list_bash",
  // file ops
  "view",
  "apply_patch",
  // search
  "rg",
  "glob",
  // agents / task management
  "task",
  "update_todo",
  "report_intent",
  // interaction
  "ask_user",
  // misc
  "skill",
  "web_fetch",
  "fetch_copilot_cli_documentation",
];

interface SessionConfigOptions extends BaseSessionConfigOptions {
  config: ServerConfig;
  hasToolBridge?: boolean | undefined;
  port: number;
  conversationId: string;
}

interface ToolBridgeContext {
  tools: readonly unknown[] | undefined;
  config: ServerConfig;
  logger: Logger;
}

function resolveToolBridge({
  tools,
  config,
  logger,
}: ToolBridgeContext): boolean {
  if (tools) {
    logger.debug(`Tools in request: ${String(tools.length)}`);
  }
  const hasBridge = !!tools?.length && config.toolBridge;
  if (hasBridge) {
    logger.info("Tool bridge active (in-process MCP)");
  }
  return hasBridge;
}

interface ProviderContext {
  conversationId: string;
  tools: readonly unknown[] | undefined;
  config: ServerConfig;
  logger: Logger;
  port: number;
}

export function createProviderSessionConfig(
  baseOptions: BaseSessionConfigOptions,
  ctx: ProviderContext,
): SessionConfig {
  const hasBridge = resolveToolBridge({
    tools: ctx.tools,
    config: ctx.config,
    logger: ctx.logger,
  });
  return createSessionConfig({
    ...baseOptions,
    config: ctx.config,
    hasToolBridge: hasBridge,
    port: ctx.port,
    conversationId: ctx.conversationId,
  });
}

export function createSessionConfig({
  model,
  systemMessage,
  logger,
  config,
  supportsReasoningEffort,
  cwd,
  provider,
  hasToolBridge,
  port,
  conversationId,
}: SessionConfigOptions): SessionConfig {
  const base = createBaseSessionConfig({
    model,
    systemMessage,
    logger,
    config,
    supportsReasoningEffort,
    cwd,
    provider,
  });

  // Hide SDK built-ins so the model uses bridge tools (forwarded to Xcode).
  const excludedTools = SDK_BUILT_IN_TOOLS.filter(
    (t) =>
      !config.allowedCliTools.includes("*") &&
      !config.allowedCliTools.includes(t),
  );

  if (!hasToolBridge) {
    return excludedTools.length > 0 ? { ...base, excludedTools } : base;
  }

  const originalOnPreToolUse = base.hooks?.onPreToolUse;

  // Bridge controls tool visibility, so remove availableTools.
  // Can't assign undefined with exactOptionalPropertyTypes, so destructure.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { availableTools, ...baseWithoutAvailableTools } = base;

  return {
    ...baseWithoutAvailableTools,
    mcpServers: {
      ...base.mcpServers,
      [BRIDGE_SERVER_NAME]: {
        type: "http" as const,
        url: `http://127.0.0.1:${String(port)}/mcp/${conversationId}`,
        tools: ["*"],
      },
    },
    excludedTools,
    hooks: {
      ...base.hooks,
      onPreToolUse: (input, invocation) => {
        if (input.toolName.startsWith(BRIDGE_TOOL_PREFIX)) {
          logger.debug(`Tool "${input.toolName}": allowed (bridge)`);
          return Promise.resolve({ permissionDecision: "allow" as const });
        }
        if (!originalOnPreToolUse) {
          return Promise.resolve({ permissionDecision: "allow" as const });
        }
        return originalOnPreToolUse(input, invocation);
      },
    },
  };
}
