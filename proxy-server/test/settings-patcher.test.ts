import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "copilot-sdk-proxy";
import {
  patchClaudeSettings,
  restoreClaudeSettings,
  detectPatchState,
  patchCodexSettings,
  restoreCodexSettings,
  detectCodexPatchState,
  patcherByProxy,
  type Settings,
  type SettingsPaths,
  type ExecFn,
} from "../src/settings-patcher/index.js";

const logger = new Logger("none");

let tempDir: string;
let paths: SettingsPaths;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "settings-patcher-test-"));
  const dir = join(tempDir, "ClaudeAgentConfig");
  paths = {
    dir,
    file: join(dir, "settings.json"),
    backup: join(dir, "settings.json.backup"),
  };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeSettings(content: Settings) {
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.file, JSON.stringify(content, null, 2) + "\n");
}

function readSettings(): Settings {
  return JSON.parse(readFileSync(paths.file, "utf-8")) as Settings;
}

function readBackup(): Settings {
  return JSON.parse(readFileSync(paths.backup, "utf-8")) as Settings;
}

describe("patcherByProxy", () => {
  it("has a patcher for claude", () => {
    expect(patcherByProxy.claude).toBeDefined();
    expect(patcherByProxy.claude!.patch).toBe(patchClaudeSettings);
    expect(patcherByProxy.claude!.restore).toBe(restoreClaudeSettings);
  });

  it("has a patcher for codex", () => {
    expect(patcherByProxy.codex).toBeDefined();
    expect(patcherByProxy.codex!.patch).toBe(patchCodexSettings);
    expect(patcherByProxy.codex!.restore).toBe(restoreCodexSettings);
  });

  it("has no patcher for openai", () => {
    expect(patcherByProxy.openai).toBeUndefined();
  });
});

describe("patchClaudeSettings", () => {
  it("creates settings.json when none exists (no backup)", async () => {
    await patchClaudeSettings({ port: 8080, logger, paths });

    expect(existsSync(paths.file)).toBe(true);
    expect(existsSync(paths.backup)).toBe(false);

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:8080");
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe("12345");
  });

  it("backs up existing settings.json before patching", async () => {
    const original: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
      mcpServers: { fs: { command: "node" } },
    };
    writeSettings(original);

    await patchClaudeSettings({ port: 3000, logger, paths });

    expect(readBackup()).toEqual(original);

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:3000");
    expect(settings.mcpServers).toEqual(original.mcpServers);
  });

  it("uses custom auth token when provided", async () => {
    await patchClaudeSettings({ port: 8080, logger, authToken: "custom-token", paths });

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe("custom-token");
  });

  it("uses default auth token when not provided", async () => {
    await patchClaudeSettings({ port: 8080, logger, paths });

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe("12345");
  });

  it("creates directory structure if needed", async () => {
    expect(existsSync(paths.dir)).toBe(false);
    await patchClaudeSettings({ port: 8080, logger, paths });
    expect(existsSync(paths.dir)).toBe(true);
    expect(existsSync(paths.file)).toBe(true);
  });

  it("preserves extra keys in settings.json", async () => {
    writeSettings({
      env: { CUSTOM_VAR: "keep" },
      mcpServers: { fs: { command: "node" } },
      customKey: "preserved",
    });

    await patchClaudeSettings({ port: 8080, logger, paths });

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:8080");
    expect(settings.env?.CUSTOM_VAR).toBe("keep");
    expect(settings.mcpServers).toEqual({ fs: { command: "node" } });
    expect(settings.customKey).toBe("preserved");
  });
});

describe("restoreClaudeSettings", () => {
  it("restores from backup", async () => {
    const original: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
    };
    writeSettings(original);

    await patchClaudeSettings({ port: 8080, logger, paths });
    await restoreClaudeSettings({ logger, paths });

    expect(readSettings()).toEqual(original);
    expect(existsSync(paths.backup)).toBe(false);
  });

  it("deletes settings.json when no backup exists", async () => {
    await patchClaudeSettings({ port: 8080, logger, paths });

    expect(existsSync(paths.file)).toBe(true);
    expect(existsSync(paths.backup)).toBe(false);

    await restoreClaudeSettings({ logger, paths });

    expect(existsSync(paths.file)).toBe(false);
  });

  it("does nothing when no files exist", async () => {
    mkdirSync(paths.dir, { recursive: true });
    await restoreClaudeSettings({ logger, paths });

    expect(existsSync(paths.file)).toBe(false);
    expect(existsSync(paths.backup)).toBe(false);
  });
});

describe("detectPatchState", () => {
  it("returns unpatched when no backup exists", async () => {
    mkdirSync(paths.dir, { recursive: true });
    const result = await detectPatchState({ logger, paths });
    expect(result.patched).toBe(false);
  });

  it("returns patched with port when backup exists", async () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" } });
    await patchClaudeSettings({ port: 8080, logger, paths });

    const result = await detectPatchState({ logger, paths });
    expect(result.patched).toBe(true);
    expect(result.port).toBe(8080);
  });

  it("returns unpatched after restore", async () => {
    writeSettings({ env: {} });
    await patchClaudeSettings({ port: 8080, logger, paths });
    await restoreClaudeSettings({ logger, paths });

    const result = await detectPatchState({ logger, paths });
    expect(result.patched).toBe(false);
  });
});

describe("full lifecycle", () => {
  it("patch then restore round-trips cleanly", async () => {
    const original: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com", CUSTOM: "keep" },
      mcpServers: { fs: { command: "node" } },
    };
    writeSettings(original);

    await patchClaudeSettings({ port: 8080, logger, paths });
    await restoreClaudeSettings({ logger, paths });

    expect(readSettings()).toEqual(original);
    expect(existsSync(paths.backup)).toBe(false);
  });

  it("no-original lifecycle: patch then restore removes settings.json", async () => {
    await patchClaudeSettings({ port: 8080, logger, paths });
    await restoreClaudeSettings({ logger, paths });

    expect(existsSync(paths.file)).toBe(false);
    expect(existsSync(paths.backup)).toBe(false);
  });

  it("crash recovery where patch then crash then patch then restore preserves original", async () => {
    const original: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
      mcpServers: { fs: { command: "node" } },
    };
    writeSettings(original);

    await patchClaudeSettings({ port: 8080, logger, paths });
    await patchClaudeSettings({ port: 9090, logger, paths });

    expect(readBackup()).toEqual(original);

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:9090");

    await restoreClaudeSettings({ logger, paths });
    expect(readSettings()).toEqual(original);
  });

  it("user edits between sessions are preserved", async () => {
    const original: Settings = { env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" } };
    writeSettings(original);

    await patchClaudeSettings({ port: 8080, logger, paths });
    await restoreClaudeSettings({ logger, paths });

    const updated: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
      mcpServers: { fs: { command: "node" } },
    };
    writeFileSync(paths.file, JSON.stringify(updated, null, 2) + "\n");

    await patchClaudeSettings({ port: 9090, logger, paths });
    await restoreClaudeSettings({ logger, paths });

    expect(readSettings()).toEqual(updated);
  });
});

// -- Codex launchctl patcher --

/**
 * Creates a mock exec that simulates launchctl setenv/unsetenv/getenv.
 * Returns the mock function and a map of the current env state.
 */
function createMockLaunchctl(): { exec: ExecFn; env: Map<string, string> } {
  const env = new Map<string, string>();
  const exec: ExecFn = (cmd: string, args: string[]) => {
    expect(cmd).toBe("launchctl");
    const [sub, ...rest] = args;
    if (sub === "setenv") {
      env.set(rest[0]!, rest[1]!);
      return Promise.resolve("");
    }
    if (sub === "unsetenv") {
      env.delete(rest[0]!);
      return Promise.resolve("");
    }
    if (sub === "getenv") {
      const val = env.get(rest[0]!);
      if (val === undefined) return Promise.reject(new Error("not set"));
      return Promise.resolve(val + "\n");
    }
    return Promise.reject(new Error(`unexpected launchctl subcommand: ${String(sub)}`));
  };
  return { exec, env };
}

describe("patchCodexSettings", () => {
  let backupFile: string;
  let mock: ReturnType<typeof createMockLaunchctl>;

  beforeEach(() => {
    backupFile = join(tempDir, "codex", "env.backup.json");
    mock = createMockLaunchctl();
  });

  it("sets OPENAI_BASE_URL and OPENAI_API_KEY", async () => {
    await patchCodexSettings({ port: 8080, logger, exec: mock.exec, backupFile });

    expect(mock.env.get("OPENAI_BASE_URL")).toBe("http://localhost:8080/v1");
    expect(mock.env.get("OPENAI_API_KEY")).toBe("xcode-copilot");
  });

  it("creates backup file with null values when no previous env vars", async () => {
    await patchCodexSettings({ port: 8080, logger, exec: mock.exec, backupFile });

    expect(existsSync(backupFile)).toBe(true);
    const backup = JSON.parse(readFileSync(backupFile, "utf-8"));
    expect(backup.OPENAI_BASE_URL).toBeNull();
    expect(backup.OPENAI_API_KEY).toBeNull();
  });

  it("saves previous env var values in backup", async () => {
    mock.env.set("OPENAI_BASE_URL", "https://api.openai.com/v1");
    mock.env.set("OPENAI_API_KEY", "sk-real-key");

    await patchCodexSettings({ port: 3000, logger, exec: mock.exec, backupFile });

    const backup = JSON.parse(readFileSync(backupFile, "utf-8"));
    expect(backup.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(backup.OPENAI_API_KEY).toBe("sk-real-key");

    // Verify new values were set
    expect(mock.env.get("OPENAI_BASE_URL")).toBe("http://localhost:3000/v1");
    expect(mock.env.get("OPENAI_API_KEY")).toBe("xcode-copilot");
  });

  it("does not overwrite backup on second patch (crash recovery)", async () => {
    mock.env.set("OPENAI_API_KEY", "sk-original");

    await patchCodexSettings({ port: 8080, logger, exec: mock.exec, backupFile });

    const firstBackup = readFileSync(backupFile, "utf-8");
    expect(JSON.parse(firstBackup).OPENAI_API_KEY).toBe("sk-original");

    // Second patch (simulating restart after crash)
    await patchCodexSettings({ port: 9090, logger, exec: mock.exec, backupFile });

    // Backup still has the original value
    const secondBackup = readFileSync(backupFile, "utf-8");
    expect(JSON.parse(secondBackup).OPENAI_API_KEY).toBe("sk-original");

    // But env was updated to new port
    expect(mock.env.get("OPENAI_BASE_URL")).toBe("http://localhost:9090/v1");
  });
});

describe("restoreCodexSettings", () => {
  let backupFile: string;
  let mock: ReturnType<typeof createMockLaunchctl>;

  beforeEach(() => {
    backupFile = join(tempDir, "codex", "env.backup.json");
    mock = createMockLaunchctl();
  });

  it("restores previous env vars from backup", async () => {
    mock.env.set("OPENAI_BASE_URL", "https://api.openai.com/v1");
    mock.env.set("OPENAI_API_KEY", "sk-real-key");

    await patchCodexSettings({ port: 8080, logger, exec: mock.exec, backupFile });
    await restoreCodexSettings({ logger, exec: mock.exec, backupFile });

    expect(mock.env.get("OPENAI_BASE_URL")).toBe("https://api.openai.com/v1");
    expect(mock.env.get("OPENAI_API_KEY")).toBe("sk-real-key");
    expect(existsSync(backupFile)).toBe(false);
  });

  it("unsets env vars when backup has null values", async () => {
    await patchCodexSettings({ port: 8080, logger, exec: mock.exec, backupFile });

    expect(mock.env.has("OPENAI_BASE_URL")).toBe(true);
    expect(mock.env.has("OPENAI_API_KEY")).toBe(true);

    await restoreCodexSettings({ logger, exec: mock.exec, backupFile });

    expect(mock.env.has("OPENAI_BASE_URL")).toBe(false);
    expect(mock.env.has("OPENAI_API_KEY")).toBe(false);
    expect(existsSync(backupFile)).toBe(false);
  });

  it("unsets env vars when no backup file exists", async () => {
    mock.env.set("OPENAI_BASE_URL", "http://localhost:8080/v1");

    await restoreCodexSettings({ logger, exec: mock.exec, backupFile });

    expect(mock.env.has("OPENAI_BASE_URL")).toBe(false);
  });
});

describe("detectCodexPatchState", () => {
  let backupFile: string;
  let mock: ReturnType<typeof createMockLaunchctl>;

  beforeEach(() => {
    backupFile = join(tempDir, "codex", "env.backup.json");
    mock = createMockLaunchctl();
  });

  it("returns unpatched when no backup exists", async () => {
    const result = await detectCodexPatchState({ logger, exec: mock.exec, backupFile });
    expect(result.patched).toBe(false);
  });

  it("returns patched with port when backup exists", async () => {
    await patchCodexSettings({ port: 8080, logger, exec: mock.exec, backupFile });

    const result = await detectCodexPatchState({ logger, exec: mock.exec, backupFile });
    expect(result.patched).toBe(true);
    expect(result.port).toBe(8080);
  });

  it("returns unpatched after restore", async () => {
    await patchCodexSettings({ port: 8080, logger, exec: mock.exec, backupFile });
    await restoreCodexSettings({ logger, exec: mock.exec, backupFile });

    const result = await detectCodexPatchState({ logger, exec: mock.exec, backupFile });
    expect(result.patched).toBe(false);
  });
});
