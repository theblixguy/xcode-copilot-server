import { describe, it, expect } from "vitest";
import { createSessionConfig } from "../../src/providers/shared/session-config.js";
import { Logger } from "copilot-sdk-proxy";
import type { ServerConfig, MCPLocalServer } from "../../src/config.js";
import type { PermissionRequest } from "copilot-sdk-proxy";

const baseConfig: ServerConfig = {
  toolBridge: false,
  mcpServers: {},
  allowedCliTools: [],
  excludedFilePatterns: [],
  bodyLimit: 4 * 1024 * 1024,
  autoApprovePermissions: true,
};

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { ...baseConfig, ...overrides };
}

function mcpStdio(overrides: Partial<MCPLocalServer> = {}): MCPLocalServer {
  return { type: "stdio", command: "node", args: [], ...overrides };
}

function permissionRequest(kind: PermissionRequest["kind"]): PermissionRequest {
  return { kind };
}

function toolUseInput(toolName: string) {
  return { toolName, toolArgs: {}, timestamp: Date.now(), cwd: "/test" };
}

function userInputRequest(question: string) {
  return { question };
}

const invocation = { sessionId: "test" };
const logger = new Logger("none");

describe("createSessionConfig", () => {
  it("sets model and streaming options", () => {
    const config = createSessionConfig({
      model: "claude-sonnet-4-5-20250929",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
    });
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.streaming).toBe(true);
    expect(config.infiniteSessions).toEqual({ enabled: true });
  });

  it("includes systemMessage when provided", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      systemMessage: "You are helpful",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
    });
    expect(config.systemMessage).toEqual({
      mode: "replace",
      content: "You are helpful",
    });
  });

  it("omits systemMessage when not provided", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
    });
    expect(config.systemMessage).toBeUndefined();
  });

  it("transforms mcpServers to always use tools: ['*']", () => {
    const mcpServers = {
      test: mcpStdio({ args: ["server.js"], allowedTools: ["tool1"] }),
    };
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ mcpServers }),
      supportsReasoningEffort: false,
    });
    expect(config.mcpServers).toEqual({
      test: { type: "stdio", command: "node", args: ["server.js"], allowedTools: ["tool1"], tools: ["*"] },
    });
  });

  it("sets workingDirectory from cwd parameter", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
      cwd: "/custom/working/dir",
    });
    expect(config.workingDirectory).toBe("/custom/working/dir");
  });

  it("defaults workingDirectory to process.cwd() when cwd not provided", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
    });
    expect(config.workingDirectory).toBe(process.cwd());
  });

  it("omits systemMessage when empty string is provided", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      systemMessage: "",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
    });
    expect(config.systemMessage).toBeUndefined();
  });
});

describe("permission callbacks", () => {
  it("approves all permissions when rule is true", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ autoApprovePermissions: true }),
      supportsReasoningEffort: false,
    });
    const result = await config.onPermissionRequest!(permissionRequest("shell"), invocation);
    expect(result).toEqual({ kind: "approved" });
  });

  it("denies all permissions when rule is false", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ autoApprovePermissions: false }),
      supportsReasoningEffort: false,
    });
    const result = await config.onPermissionRequest!(permissionRequest("read"), invocation);
    expect(result).toEqual({ kind: "denied-by-rules" });
  });

  it("approves matching permission from string array", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ autoApprovePermissions: ["read", "write"] }),
      supportsReasoningEffort: false,
    });
    const result = await config.onPermissionRequest!(permissionRequest("read"), invocation);
    expect(result).toEqual({ kind: "approved" });
  });

  it("denies non-matching permission from string array", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ autoApprovePermissions: ["read"] }),
      supportsReasoningEffort: false,
    });
    const result = await config.onPermissionRequest!(permissionRequest("shell"), invocation);
    expect(result).toEqual({ kind: "denied-by-rules" });
  });
});

describe("tool filtering", () => {
  it("denies all tools when both allowlists are empty", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: [], mcpServers: {} }),
      supportsReasoningEffort: false,
    });
    const result = await config.hooks!.onPreToolUse!(toolUseInput("anything"), invocation);
    expect(result).toEqual({ permissionDecision: "deny" });
  });

  it("allows CLI tools from allowedCliTools", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: ["glob", "grep"] }),
      supportsReasoningEffort: false,
    });
    const allowed = await config.hooks!.onPreToolUse!(toolUseInput("glob"), invocation);
    expect(allowed).toEqual({ permissionDecision: "allow" });
    const denied = await config.hooks!.onPreToolUse!(toolUseInput("bash"), invocation);
    expect(denied).toEqual({ permissionDecision: "deny" });
  });

  it("allows MCP tools from server allowedTools", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({
        allowedCliTools: [],
        mcpServers: {
          xcode: mcpStdio({ allowedTools: ["XcodeBuild"] }),
        },
      }),
      supportsReasoningEffort: false,
    });
    const allowed = await config.hooks!.onPreToolUse!(toolUseInput("XcodeBuild"), invocation);
    expect(allowed).toEqual({ permissionDecision: "allow" });
    const denied = await config.hooks!.onPreToolUse!(toolUseInput("XcodeTest"), invocation);
    expect(denied).toEqual({ permissionDecision: "deny" });
  });

  it("allows tools with wildcard in allowedCliTools", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: ["*"] }),
      supportsReasoningEffort: false,
    });
    const result = await config.hooks!.onPreToolUse!(toolUseInput("anything"), invocation);
    expect(result).toEqual({ permissionDecision: "allow" });
  });

  it("allows tools with wildcard in server allowedTools", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({
        allowedCliTools: [],
        mcpServers: {
          xcode: mcpStdio({ allowedTools: ["*"] }),
        },
      }),
      supportsReasoningEffort: false,
    });
    const result = await config.hooks!.onPreToolUse!(toolUseInput("anything"), invocation);
    expect(result).toEqual({ permissionDecision: "allow" });
  });

  it("checks all allowlists across CLI and MCP servers", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({
        allowedCliTools: ["glob"],
        mcpServers: {
          xcode: mcpStdio({ allowedTools: ["XcodeBuild"] }),
          other: mcpStdio({ allowedTools: ["CustomTool"] }),
        },
      }),
      supportsReasoningEffort: false,
    });
    const cliAllowed = await config.hooks!.onPreToolUse!(toolUseInput("glob"), invocation);
    expect(cliAllowed).toEqual({ permissionDecision: "allow" });
    const mcp1Allowed = await config.hooks!.onPreToolUse!(toolUseInput("XcodeBuild"), invocation);
    expect(mcp1Allowed).toEqual({ permissionDecision: "allow" });
    const mcp2Allowed = await config.hooks!.onPreToolUse!(toolUseInput("CustomTool"), invocation);
    expect(mcp2Allowed).toEqual({ permissionDecision: "allow" });
    const denied = await config.hooks!.onPreToolUse!(toolUseInput("NotAllowed"), invocation);
    expect(denied).toEqual({ permissionDecision: "deny" });
  });

  it("passes allowedCliTools as availableTools when non-empty", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: ["glob", "grep"] }),
      supportsReasoningEffort: false,
    });
    expect(config.availableTools).toEqual(["glob", "grep"]);
  });

  it("omits availableTools when allowedCliTools is empty", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: [] }),
      supportsReasoningEffort: false,
    });
    expect(config.availableTools).toBeUndefined();
  });

  it("allows xcode-bridge-* tools when bridge is active", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
      hasToolBridge: true,
      port: 8080,
    });
    const result = await config.hooks!.onPreToolUse!(toolUseInput("xcode-bridge-Read"), invocation);
    expect(result).toEqual({ permissionDecision: "allow" });
  });

  it("allows CLI tools alongside bridge when allowedCliTools is set", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: ["glob", "grep"] }),
      supportsReasoningEffort: false,
      hasToolBridge: true,
      port: 8080,
    });
    // Bridge tools allowed
    const bridge = await config.hooks!.onPreToolUse!(toolUseInput("xcode-bridge-Read"), invocation);
    expect(bridge).toEqual({ permissionDecision: "allow" });
    // CLI tools also allowed (additive)
    const cli = await config.hooks!.onPreToolUse!(toolUseInput("glob"), invocation);
    expect(cli).toEqual({ permissionDecision: "allow" });
    // Unknown tools still denied
    const denied = await config.hooks!.onPreToolUse!(toolUseInput("NotAllowed"), invocation);
    expect(denied).toEqual({ permissionDecision: "deny" });
  });

  it("does not activate bridge when hasToolBridge is false", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: [] }),
      supportsReasoningEffort: false,
      hasToolBridge: false,
      port: 8080,
    });
    // No bridge, so xcode-bridge-* tools are denied
    const result = await config.hooks!.onPreToolUse!(toolUseInput("xcode-bridge-Read"), invocation);
    expect(result).toEqual({ permissionDecision: "deny" });
    // No xcode-bridge MCP server entry
    expect(config.mcpServers).toEqual({});
  });

  it("does not activate bridge when hasToolBridge is omitted", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ allowedCliTools: [] }),
      supportsReasoningEffort: false,
      port: 8080,
    });
    const result = await config.hooks!.onPreToolUse!(toolUseInput("xcode-bridge-Read"), invocation);
    expect(result).toEqual({ permissionDecision: "deny" });
    expect(config.mcpServers).toEqual({});
  });

  it("sets HTTP MCP URL with port and conversationId", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
      hasToolBridge: true,
      port: 9090,
      conversationId: "conv-abc-123",
    });
    const bridge = config.mcpServers?.["xcode-bridge"] as { type: string; url: string; tools: string[] };
    expect(bridge.type).toBe("http");
    expect(bridge.url).toBe("http://127.0.0.1:9090/mcp/conv-abc-123");
    expect(bridge.tools).toEqual(["*"]);
  });

  it("defaults port to 8080 and conversationId to empty in MCP URL", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
      hasToolBridge: true,
    });
    const bridge = config.mcpServers?.["xcode-bridge"] as { type: string; url: string };
    expect(bridge.type).toBe("http");
    expect(bridge.url).toBe("http://127.0.0.1:8080/mcp/");
  });
});

describe("onUserInputRequest", () => {
  it("returns a fallback answer for user input requests", async () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
    });
    const result = await config.onUserInputRequest!(
      userInputRequest("Which file?"),
      invocation,
    );
    expect(result.answer).toContain("not available");
    expect(result.wasFreeform).toBe(true);
  });
});

describe("reasoningEffort", () => {
  it("passes reasoningEffort when set and model supports it", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ reasoningEffort: "high" }),
      supportsReasoningEffort: true,
    });
    expect(config.reasoningEffort).toBe("high");
  });

  it("omits reasoningEffort when set but model does not support it", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig({ reasoningEffort: "high" }),
      supportsReasoningEffort: false,
    });
    expect(config.reasoningEffort).toBeUndefined();
  });

  it("omits reasoningEffort when not set", () => {
    const config = createSessionConfig({
      model: "gpt-4",
      logger,
      config: makeConfig(),
      supportsReasoningEffort: false,
    });
    expect(config.reasoningEffort).toBeUndefined();
  });
});
