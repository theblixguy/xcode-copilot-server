import type { SessionConfig } from "@github/copilot-sdk";
import type { ServerConfig, ApprovalRule } from "../../config.js";
import type { Logger } from "../../logger.js";
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
  hasToolBridge?: boolean;
  port?: number | undefined;
  conversationId?: string | undefined;
}

function isApproved(rule: ApprovalRule, kind: string): boolean {
  if (typeof rule === "boolean") return rule;
  return rule.some((k) => k === kind);
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
  const hasBridge = !!hasToolBridge;

  return {
    model,
    streaming: true,
    infiniteSessions: { enabled: true },
    workingDirectory: cwd ?? process.cwd(),

    ...(systemMessage && {
      systemMessage: {
        mode: "replace" as const,
        content: systemMessage,
      },
    }),

    mcpServers: {
      ...Object.fromEntries(
        Object.entries(config.mcpServers).map(([name, server]) => [
          name,
          { ...server, tools: ["*"] },
        ]),
      ),
      ...(hasBridge && {
        [BRIDGE_SERVER_NAME]: {
          type: "http" as const,
          url: `http://127.0.0.1:${String(port ?? 8080)}/mcp/${conversationId ?? ""}`,
          tools: ["*"],
        },
      }),
    },

    // When the tool bridge is active, exclude SDK built-in tools so the
    // model uses bridge tools instead (forwarded to Xcode). Tools the user
    // explicitly allows via allowedCliTools are kept. MCP server tools
    // (e.g. github-mcp-server-*) are unaffected by this list.
    ...(hasBridge && {
      excludedTools: SDK_BUILT_IN_TOOLS.filter(
        (t) => !config.allowedCliTools.includes("*") && !config.allowedCliTools.includes(t),
      ),
    }),
    ...(!hasBridge && config.allowedCliTools.length > 0 && {
      availableTools: config.allowedCliTools,
    }),
    ...(config.reasoningEffort && supportsReasoningEffort && {
      reasoningEffort: config.reasoningEffort,
    }),

    onUserInputRequest: (request) => {
      logger.debug(`User input requested: "${request.question}"`);
      return Promise.resolve({
        answer:
          "User input is not available. Ask your question in your response instead.",
        wasFreeform: true,
      });
    },

    onPermissionRequest: (request) => {
      const approved = isApproved(config.autoApprovePermissions, request.kind);
      logger.debug(
        `Permission "${request.kind}": ${approved ? "approved" : "denied"}`,
      );
      return Promise.resolve(
        approved
          ? { kind: "approved" as const }
          : { kind: "denied-by-rules" as const },
      );
    },

    hooks: {
      onPreToolUse: (input) => {
        const toolName = input.toolName;

        if (hasBridge && toolName.startsWith(BRIDGE_TOOL_PREFIX)) {
          logger.debug(`Tool "${toolName}": allowed (bridge)`);
          return Promise.resolve({ permissionDecision: "allow" as const });
        }

        if (config.allowedCliTools.includes("*") || config.allowedCliTools.includes(toolName)) {
          logger.debug(`Tool "${toolName}": allowed (CLI)`);
          return Promise.resolve({ permissionDecision: "allow" as const });
        }

        for (const [serverName, server] of Object.entries(config.mcpServers)) {
          const allowlist = server.allowedTools ?? [];
          if (allowlist.includes("*") || allowlist.includes(toolName)) {
            logger.debug(`Tool "${toolName}": allowed (${serverName})`);
            return Promise.resolve({ permissionDecision: "allow" as const });
          }
        }

        logger.debug(`Tool "${toolName}": denied (not in any allowlist)`);
        return Promise.resolve({ permissionDecision: "deny" as const });
      },
    },
  };
}
