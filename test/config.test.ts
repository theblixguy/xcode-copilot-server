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
    const config = await loadConfig("/nonexistent/config.json5", logger);
    expect(config.passthroughMcpServer).toBeNull();
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
    const config = await loadConfig(path, logger);
    expect(config.allowedCliTools).toEqual(["search"]);
    expect(config.bodyLimit).toBe(1 * 1024 * 1024);
    expect(config.mcpServers).toEqual({});
    expect(config.autoApprovePermissions).toEqual(["read", "mcp"]);
  });

  it("throws on invalid config (non-object)", async () => {
    const path = writeConfig("bad.json5", `"not an object"`);
    await expect(loadConfig(path, logger)).rejects.toThrow(
      "Config file must contain a JSON5 object",
    );
  });

  it("throws on invalid JSON5 syntax", async () => {
    const path = writeConfig("bad.json5", `{ broken:`);
    await expect(loadConfig(path, logger)).rejects.toThrow(
      /Failed to parse config file/,
    );
  });

  it("overrides autoApprovePermissions", async () => {
    const path = writeConfig(
      "perms.json5",
      `{ autoApprovePermissions: ["read", "write"] }`,
    );
    const config = await loadConfig(path, logger);
    expect(config.autoApprovePermissions).toEqual(["read", "write"]);
  });

  it("resolves relative MCP server args to config directory", async () => {
    const path = writeConfig(
      "mcp.json5",
      `{
        mcpServers: {
          local: {
            type: "local",
            command: "node",
            args: ["./server.js", "--flag"],
          },
        },
      }`,
    );
    const config = await loadConfig(path, logger);
    const args = (config.mcpServers.local as any).args;
    expect(args[0]).toBe(join(tempDir, "server.js"));
    expect(args[1]).toBe("--flag");
  });

  it("leaves absolute MCP server args unchanged", async () => {
    const path = writeConfig(
      "abs.json5",
      `{
        mcpServers: {
          local: {
            type: "local",
            command: "node",
            args: ["/usr/bin/server.js"],
          },
        },
      }`,
    );
    const config = await loadConfig(path, logger);
    const args = (config.mcpServers.local as any).args;
    expect(args[0]).toBe("/usr/bin/server.js");
  });

  it("loads reasoningEffort", async () => {
    const path = writeConfig(
      "reason.json5",
      `{ reasoningEffort: "high" }`,
    );
    const config = await loadConfig(path, logger);
    expect(config.reasoningEffort).toBe("high");
  });

  it("loads allowedCliTools", async () => {
    const path = writeConfig(
      "allowed.json5",
      `{ allowedCliTools: ["search", "read_file"] }`,
    );
    const config = await loadConfig(path, logger);
    expect(config.allowedCliTools).toEqual(["search", "read_file"]);
  });

  it("converts bodyLimitMiB to bytes", async () => {
    const path = writeConfig("limit.json5", `{ bodyLimitMiB: 10 }`);
    const config = await loadConfig(path, logger);
    expect(config.bodyLimit).toBe(10 * 1024 * 1024);
  });

  it("loads passthroughMcpServer with relative path resolution", async () => {
    const path = writeConfig(
      "passthrough.json5",
      `{
        passthroughMcpServer: {
          command: "node",
          args: ["./scripts/mcp-passthrough.mjs"],
        },
      }`,
    );
    const config = await loadConfig(path, logger);
    expect(config.passthroughMcpServer).toEqual({
      command: "node",
      args: [join(tempDir, "scripts/mcp-passthrough.mjs")],
    });
  });

  it("defaults passthroughMcpServer to null when absent", async () => {
    const path = writeConfig("minimal.json5", `{}`);
    const config = await loadConfig(path, logger);
    expect(config.passthroughMcpServer).toBeNull();
  });

  it("allows explicit null for passthroughMcpServer", async () => {
    const path = writeConfig(
      "null-passthrough.json5",
      `{ passthroughMcpServer: null }`,
    );
    const config = await loadConfig(path, logger);
    expect(config.passthroughMcpServer).toBeNull();
  });
});

describe("config validation", () => {
  it("rejects invalid bodyLimitMiB (negative)", async () => {
    const path = writeConfig("bad.json5", `{ bodyLimitMiB: -1 }`);
    await expect(loadConfig(path, logger)).rejects.toThrow(/bodyLimitMiB.*>0/i);
  });

  it("rejects invalid bodyLimitMiB (too large)", async () => {
    const path = writeConfig("bad.json5", `{ bodyLimitMiB: 200 }`);
    await expect(loadConfig(path, logger)).rejects.toThrow(/100/i);
  });

  it("rejects invalid reasoningEffort", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ reasoningEffort: "invalid" }`,
    );
    await expect(loadConfig(path, logger)).rejects.toThrow(/reasoningEffort/i);
  });

  it("rejects non-array allowedCliTools", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ allowedCliTools: "not-an-array" }`,
    );
    await expect(loadConfig(path, logger)).rejects.toThrow(/array/i);
  });

  it("rejects wildcard mixed with other entries in allowedCliTools", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ allowedCliTools: ["*", "update_todo"] }`,
    );
    await expect(loadConfig(path, logger)).rejects.toThrow(/alone/i);
  });

  it("rejects invalid autoApprovePermissions array", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ autoApprovePermissions: ["invalid"] }`,
    );
    await expect(loadConfig(path, logger)).rejects.toThrow(/invalid/i);
  });

  it("rejects invalid MCP server (missing command)", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ mcpServers: { test: { args: [] } } }`,
    );
    await expect(loadConfig(path, logger)).rejects.toThrow(/Invalid/i);
  });

  it("rejects invalid MCP server URL", async () => {
    const path = writeConfig(
      "bad.json5",
      `{
        mcpServers: {
          test: { type: "http", url: "not-a-url" }
        }
      }`,
    );
    await expect(loadConfig(path, logger)).rejects.toThrow(/url/i);
  });

  it("rejects invalid passthroughMcpServer (missing command)", async () => {
    const path = writeConfig(
      "bad.json5",
      `{ passthroughMcpServer: { args: [] } }`,
    );
    await expect(loadConfig(path, logger)).rejects.toThrow(/Invalid/i);
  });

  it("uses defaults for missing optional fields", async () => {
    const path = writeConfig("minimal.json5", `{}`);
    const config = await loadConfig(path, logger);
    expect(config.passthroughMcpServer).toBeNull();
    expect(config.mcpServers).toEqual({});
    expect(config.allowedCliTools).toEqual([]);
    expect(config.bodyLimit).toBe(4 * 1024 * 1024);
    expect(config.autoApprovePermissions).toEqual(["read", "mcp"]);
  });
});
