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
import { Logger } from "../src/logger.js";
import {
  patchSettings,
  restoreSettings,
  detectPatchState,
  type Settings,
  type SettingsPaths,
} from "../src/settings-patcher.js";

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

describe("patchSettings", () => {
  it("creates settings.json when none exists (no backup)", async () => {
    await patchSettings({ port: 8080, logger, paths });

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

    await patchSettings({ port: 3000, logger, paths });

    expect(readBackup()).toEqual(original);

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:3000");
    expect(settings.mcpServers).toEqual(original.mcpServers);
  });

  it("uses custom auth token when provided", async () => {
    await patchSettings({ port: 8080, logger, authToken: "custom-token", paths });

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe("custom-token");
  });

  it("uses default auth token when not provided", async () => {
    await patchSettings({ port: 8080, logger, paths });

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe("12345");
  });

  it("creates directory structure if needed", async () => {
    expect(existsSync(paths.dir)).toBe(false);
    await patchSettings({ port: 8080, logger, paths });
    expect(existsSync(paths.dir)).toBe(true);
    expect(existsSync(paths.file)).toBe(true);
  });

  it("preserves extra keys in settings.json", async () => {
    writeSettings({
      env: { CUSTOM_VAR: "keep" },
      mcpServers: { fs: { command: "node" } },
      customKey: "preserved",
    });

    await patchSettings({ port: 8080, logger, paths });

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:8080");
    expect(settings.env?.CUSTOM_VAR).toBe("keep");
    expect(settings.mcpServers).toEqual({ fs: { command: "node" } });
    expect(settings.customKey).toBe("preserved");
  });
});

describe("restoreSettings", () => {
  it("restores from backup", async () => {
    const original: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
    };
    writeSettings(original);

    await patchSettings({ port: 8080, logger, paths });
    await restoreSettings({ logger, paths });

    expect(readSettings()).toEqual(original);
    expect(existsSync(paths.backup)).toBe(false);
  });

  it("deletes settings.json when no backup exists", async () => {
    await patchSettings({ port: 8080, logger, paths });

    expect(existsSync(paths.file)).toBe(true);
    expect(existsSync(paths.backup)).toBe(false);

    await restoreSettings({ logger, paths });

    expect(existsSync(paths.file)).toBe(false);
  });

  it("does nothing when no files exist", async () => {
    mkdirSync(paths.dir, { recursive: true });
    await restoreSettings({ logger, paths });

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
    await patchSettings({ port: 8080, logger, paths });

    const result = await detectPatchState({ logger, paths });
    expect(result.patched).toBe(true);
    expect(result.port).toBe(8080);
  });

  it("returns unpatched after restore", async () => {
    writeSettings({ env: {} });
    await patchSettings({ port: 8080, logger, paths });
    await restoreSettings({ logger, paths });

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

    await patchSettings({ port: 8080, logger, paths });
    await restoreSettings({ logger, paths });

    expect(readSettings()).toEqual(original);
    expect(existsSync(paths.backup)).toBe(false);
  });

  it("no-original lifecycle: patch then restore removes settings.json", async () => {
    await patchSettings({ port: 8080, logger, paths });
    await restoreSettings({ logger, paths });

    expect(existsSync(paths.file)).toBe(false);
    expect(existsSync(paths.backup)).toBe(false);
  });

  it("crash recovery where patch then crash then patch then restore preserves original", async () => {
    const original: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
      mcpServers: { fs: { command: "node" } },
    };
    writeSettings(original);

    await patchSettings({ port: 8080, logger, paths });
    await patchSettings({ port: 9090, logger, paths });

    expect(readBackup()).toEqual(original);

    const settings = readSettings();
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:9090");

    await restoreSettings({ logger, paths });
    expect(readSettings()).toEqual(original);
  });

  it("user edits between sessions are preserved", async () => {
    const original: Settings = { env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" } };
    writeSettings(original);

    await patchSettings({ port: 8080, logger, paths });
    await restoreSettings({ logger, paths });

    const updated: Settings = {
      env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
      mcpServers: { fs: { command: "node" } },
    };
    writeFileSync(paths.file, JSON.stringify(updated, null, 2) + "\n");

    await patchSettings({ port: 9090, logger, paths });
    await restoreSettings({ logger, paths });

    expect(readSettings()).toEqual(updated);
  });
});
