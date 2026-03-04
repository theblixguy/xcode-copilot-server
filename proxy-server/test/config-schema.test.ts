import { describe, it, expect } from "vitest";
import { ServerConfigSchema, BYTES_PER_MIB, DEFAULT_CONFIG } from "../src/config-schema.js";

describe("ServerConfigSchema", () => {
  it("accepts empty object with defaults", () => {
    const result = ServerConfigSchema.parse({});
    expect(result.openai.toolBridge).toBe(false);
    expect(result.claude.toolBridge).toBe(false);
    expect(result.codex.toolBridge).toBe(false);
    expect(result.allowedCliTools).toEqual([]);
    expect(result.bodyLimitMiB).toBe(10);
  });

  it("accepts valid provider config", () => {
    const result = ServerConfigSchema.parse({
      claude: { toolBridge: true, mcpServers: {} },
    });
    expect(result.claude.toolBridge).toBe(true);
  });

  it("accepts valid MCP local server", () => {
    const result = ServerConfigSchema.parse({
      openai: {
        mcpServers: {
          test: { type: "local", command: "node", args: ["server.js"] },
        },
      },
    });
    expect(result.openai.mcpServers.test).toBeDefined();
  });

  it("accepts valid MCP remote server", () => {
    const result = ServerConfigSchema.parse({
      openai: {
        mcpServers: {
          remote: { type: "http", url: "https://example.com/mcp" },
        },
      },
    });
    expect(result.openai.mcpServers.remote).toBeDefined();
  });

  it("rejects invalid MCP server URL", () => {
    expect(() =>
      ServerConfigSchema.parse({
        openai: {
          mcpServers: { bad: { type: "http", url: "not-a-url" } },
        },
      }),
    ).toThrow();
  });

  it("rejects MCP server without command", () => {
    expect(() =>
      ServerConfigSchema.parse({
        openai: {
          mcpServers: { bad: { type: "local", args: [] } },
        },
      }),
    ).toThrow();
  });

  it("rejects negative bodyLimitMiB", () => {
    expect(() => ServerConfigSchema.parse({ bodyLimitMiB: -1 })).toThrow();
  });

  it("rejects bodyLimitMiB over 100", () => {
    expect(() => ServerConfigSchema.parse({ bodyLimitMiB: 200 })).toThrow();
  });

  it("rejects invalid reasoningEffort", () => {
    expect(() =>
      ServerConfigSchema.parse({ reasoningEffort: "invalid" }),
    ).toThrow();
  });

  it("accepts valid reasoningEffort values", () => {
    for (const effort of ["low", "medium", "high", "xhigh"]) {
      const result = ServerConfigSchema.parse({ reasoningEffort: effort });
      expect(result.reasoningEffort).toBe(effort);
    }
  });

  it("rejects wildcard mixed with other allowedCliTools", () => {
    expect(() =>
      ServerConfigSchema.parse({ allowedCliTools: ["*", "read"] }),
    ).toThrow(/alone/i);
  });

  it("accepts wildcard alone in allowedCliTools", () => {
    const result = ServerConfigSchema.parse({ allowedCliTools: ["*"] });
    expect(result.allowedCliTools).toEqual(["*"]);
  });

  it("rejects invalid autoApprovePermissions", () => {
    expect(() =>
      ServerConfigSchema.parse({ autoApprovePermissions: ["invalid"] }),
    ).toThrow();
  });

  it("accepts boolean autoApprovePermissions", () => {
    const result = ServerConfigSchema.parse({ autoApprovePermissions: true });
    expect(result.autoApprovePermissions).toBe(true);
  });
});

describe("BYTES_PER_MIB", () => {
  it("equals 1024 * 1024", () => {
    expect(BYTES_PER_MIB).toBe(1_048_576);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has expected shape", () => {
    expect(DEFAULT_CONFIG.toolBridge).toBe(false);
    expect(DEFAULT_CONFIG.mcpServers).toEqual({});
    expect(DEFAULT_CONFIG.allowedCliTools).toEqual([]);
    expect(DEFAULT_CONFIG.bodyLimit).toBe(10 * BYTES_PER_MIB);
    expect(DEFAULT_CONFIG.autoApprovePermissions).toEqual(["read", "mcp"]);
  });
});
