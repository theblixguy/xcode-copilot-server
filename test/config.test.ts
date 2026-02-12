import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";

const logger = new Logger("none");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeConfig(filename: string, content: string): string {
  const path = join(tempDir, filename);
  writeFileSync(path, content);
  return path;
}

describe("loadConfig", () => {
  it("returns defaults when config file does not exist", async () => {
    const config = await loadConfig("/nonexistent/config.json5", logger, "openai");
    expect(config.toolBridge).toBe(false);
    expect(config.mcpServers).toEqual({});
    expect(config.allowedCliTools).toEqual([]);
    expect(config.excludedFilePatterns).toEqual([]);
    expect(config.bodyLimit).toBe(4 * 1024 * 1024);
    expect(config.reasoningEffort).toBeUndefined();
    expect(config.autoApprovePermissions).toEqual(["read", "mcp"]);
  });

  it("merges provided fields with defaults", async () => {
    const path = writeConfig(
      "config.json5",
      `{ allowedCliTools: ["search"], bodyLimitMiB: 1 }`,
    );
    const config = await loadConfig(path, logger, "openai");
    expect(config.allowedCliTools).toEqual(["search"]);
    expect(config.bodyLimit).toBe(1 * 1024 * 1024);
    expect(config.mcpServers).toEqual({});
    expect(config.autoApprovePermissions).toEqual(["read", "mcp"]);
  });

  it("throws on invalid config (non-object)", async () => {
    const path = writeConfig("bad.json5", `"not an object"`);
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(
      "Config file must contain a JSON5 object",
    );
  });

  it("throws on invalid JSON5 syntax", async () => {
    const path = writeConfig("bad.json5", `{ broken:`);
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(
      /Failed to parse config file/,
    );
  });

  it("overrides autoApprovePermissions", async () => {
    const path = writeConfig(
      "perms.json5",
      `{ autoApprovePermissions: ["read", "write"] }`,
    );
    const config = await loadConfig(path, logger, "openai");
    expect(config.autoApprovePermissions).toEqual(["read", "write"]);
  });

  it("resolves relative MCP server args to config directory", async () => {
    const path = writeConfig(
      "mcp.json5",
      `{
        openai: {
          mcpServers: {
            local: {
              type: "local",
              command: "node",
              args: ["./server.js", "--flag"],
            },
          },
        },
      }`,
    );
    const config = await loadConfig(path, logger, "openai");
    const args = (config.mcpServers.local as any).args;
    expect(args[0]).toBe(join(tempDir, "server.js"));
    expect(args[1]).toBe("--flag");
  });

  it("leaves absolute MCP server args unchanged", async () => {
    const path = writeConfig(
      "abs.json5",
      `{
        anthropic: {
          mcpServers: {
            local: {
              type: "local",
              command: "node",
              args: ["/usr/bin/server.js"],
            },
          },
        },
      }`,
    );
    const config = await loadConfig(path, logger, "anthropic");
    const args = (config.mcpServers.local as any).args;
    expect(args[0]).toBe("/usr/bin/server.js");
  });

  it("loads reasoningEffort", async () => {
    const path = writeConfig(
      "reason.json5",
      `{ reasoningEffort: "high" }`,
    );
    const config = await loadConfig(path, logger, "openai");
    expect(config.reasoningEffort).toBe("high");
  });

  it("loads allowedCliTools", async () => {
    const path = writeConfig(
      "allowed.json5",
      `{ allowedCliTools: ["search", "read_file"] }`,
    );
    const config = await loadConfig(path, logger, "openai");
    expect(config.allowedCliTools).toEqual(["search", "read_file"]);
  });

  it("converts bodyLimitMiB to bytes", async () => {
    const path = writeConfig("limit.json5", `{ bodyLimitMiB: 10 }`);
    const config = await loadConfig(path, logger, "openai");
    expect(config.bodyLimit).toBe(10 * 1024 * 1024);
  });

  it("loads toolBridge as boolean", async () => {
    const path = writeConfig(
      "bridge.json5",
      `{
        anthropic: {
          toolBridge: true,
        },
      }`,
    );
    const config = await loadConfig(path, logger, "anthropic");
    expect(config.toolBridge).toBe(true);
  });

  it("defaults toolBridge to false when absent", async () => {
    const path = writeConfig("minimal.json5", `{}`);
    const config = await loadConfig(path, logger, "openai");
    expect(config.toolBridge).toBe(false);
  });

  it("uses the correct provider section based on proxy", async () => {
    const path = writeConfig(
      "both.json5",
      `{
        openai: {
          toolBridge: false,
          mcpServers: {
            xcode: { type: "local", command: "node", args: ["/xcode.js"], allowedTools: ["*"] },
          },
        },
        anthropic: {
          toolBridge: true,
          mcpServers: {},
        },
      }`,
    );
    const openai = await loadConfig(path, logger, "openai");
    expect(openai.toolBridge).toBe(false);
    expect(Object.keys(openai.mcpServers)).toEqual(["xcode"]);

    const anthropic = await loadConfig(path, logger, "anthropic");
    expect(anthropic.toolBridge).toBe(true);
    expect(anthropic.mcpServers).toEqual({});
  });
});

describe("config validation", () => {
  it("rejects invalid bodyLimitMiB (negative)", async () => {
    const path = writeConfig("bad.json5", `{ bodyLimitMiB: -1 }`);
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/bodyLimitMiB.*>0/i);
  });

  it("rejects invalid bodyLimitMiB (too large)", async () => {
    const path = writeConfig("bad.json5", `{ bodyLimitMiB: 200 }`);
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/100/i);
  });

  it("rejects invalid reasoningEffort", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ reasoningEffort: "invalid" }`,
    );
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/reasoningEffort/i);
  });

  it("rejects non-array allowedCliTools", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ allowedCliTools: "not-an-array" }`,
    );
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/array/i);
  });

  it("rejects wildcard mixed with other entries in allowedCliTools", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ allowedCliTools: ["*", "update_todo"] }`,
    );
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/alone/i);
  });

  it("rejects invalid autoApprovePermissions array", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ autoApprovePermissions: ["invalid"] }`,
    );
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/invalid/i);
  });

  it("rejects invalid MCP server (missing command)", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ openai: { mcpServers: { test: { args: [] } } } }`,
    );
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/Invalid/i);
  });

  it("rejects invalid MCP server URL", async () => {
    const path = writeConfig(
      "bad.json5",
      `{
        openai: {
          mcpServers: {
            test: { type: "http", url: "not-a-url" }
          }
        }
      }`,
    );
    await expect(loadConfig(path, logger, "openai")).rejects.toThrow(/url/i);
  });

  it("rejects invalid toolBridge (non-boolean)", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ anthropic: { toolBridge: "yes" } }`,
    );
    await expect(loadConfig(path, logger, "anthropic")).rejects.toThrow(/Invalid/i);
  });

  it("uses defaults for missing optional fields", async () => {
    const path = writeConfig("minimal.json5", `{}`);
    const config = await loadConfig(path, logger, "openai");
    expect(config.toolBridge).toBe(false);
    expect(config.mcpServers).toEqual({});
    expect(config.allowedCliTools).toEqual([]);
    expect(config.bodyLimit).toBe(4 * 1024 * 1024);
    expect(config.autoApprovePermissions).toEqual(["read", "mcp"]);
  });
});
