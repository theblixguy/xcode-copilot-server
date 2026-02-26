import type { SessionConfig, Logger } from "copilot-sdk-proxy";
import { createSessionConfig as createBaseSessionConfig } from "copilot-sdk-proxy";
import type { ServerConfig } from "../../config.js";
import { BRIDGE_SERVER_NAME, BRIDGE_TOOL_PREFIX } from "../../tool-bridge/index.js";

const SDK_BUILT_IN_TOOLS: string[] = [
  // shell
  "bash", "write_bash", "read_bash", "stop_bash", "list_bash",
  // file ops
  "view", "apply_patch",
  // search
  "rg", "glob",
  // agents / task management
  "task", "update_todo", "report_intent",
  // interaction
  "ask_user",
  // misc
  "skill", "web_fetch", "fetch_copilot_cli_documentation",
];

export interface SessionConfigOptions {
  model: string;
  systemMessage?: string | undefined;
  logger: Logger;
  config: ServerConfig;
  supportsReasoningEffort: boolean;
  cwd?: string | undefined;
  hasToolBridge?: boolean | undefined;
  port: number;
  conversationId: string;
}

export function createSessionConfig({
  model,
  systemMessage,
  logger,
  config,
  supportsReasoningEffort,
  cwd,
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
  });

  if (!hasToolBridge) return base;

  // Layer bridge-specific config on top of what core already provides.
  const originalOnPreToolUse = base.hooks?.onPreToolUse;

  // Strip availableTools so the bridge controls tool visibility instead.
  // With exactOptionalPropertyTypes we can't assign undefined, so we
  // destructure it out.
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
    // Hide SDK built-in tools so the model uses bridge tools instead,
    // which get forwarded to Xcode for execution.
    excludedTools: SDK_BUILT_IN_TOOLS.filter(
      (t) => !config.allowedCliTools.includes("*") && !config.allowedCliTools.includes(t),
    ),
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
