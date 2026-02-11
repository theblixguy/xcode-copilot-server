import type { SessionConfig } from "@github/copilot-sdk";
import type { ServerConfig, ApprovalRule, ToolBridgeServer } from "../config.js";
import type { Logger } from "../logger.js";

export interface SessionConfigOptions {
  model: string;
  systemMessage?: string | undefined;
  logger: Logger;
  config: ServerConfig;
  supportsReasoningEffort: boolean;
  cwd?: string | undefined;
  toolBridgeServer?: ToolBridgeServer | null | undefined;
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
  toolBridgeServer,
  port,
  conversationId,
}: SessionConfigOptions): SessionConfig {
  const hasBridge = !!toolBridgeServer;

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
      ...(toolBridgeServer && {
        "xcode-bridge": {
          type: "local" as const,
          command: toolBridgeServer.command,
          args: [
            ...toolBridgeServer.args,
            `--port=${String(port ?? 8080)}`,
            `--conv-id=${conversationId ?? ""}`,
          ],
          env: {
            MCP_SERVER_PORT: String(port ?? 8080),
            MCP_CONVERSATION_ID: conversationId ?? "",
          },
          tools: ["*"],
        },
      }),
    },

    // When the tool bridge is active, don't restrict availableTools so the CLI
    // can expose the bridged tools to the model. The onPreToolUse hook handles
    // permissions instead.
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

        if (hasBridge && toolName.startsWith("xcode-bridge-")) {
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
