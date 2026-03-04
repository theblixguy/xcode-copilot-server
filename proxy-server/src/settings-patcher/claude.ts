import { existsSync } from "node:fs";
import { readFile, writeFile, rename, unlink, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  SettingsPaths,
  Settings,
  PatchResult,
  PatchOptions,
  RestoreOptions,
  DetectOptions,
} from "./types.js";
import { extractLocalhostPort } from "./url-utils.js";

// Claude agent requires ANTHROPIC_AUTH_TOKEN to connect, but any value works for the local proxy.
const DUMMY_AUTH_TOKEN = "xcode-copilot";

function defaultSettingsPaths(): SettingsPaths {
  const dir = join(
    homedir(),
    "Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig",
  );
  return {
    dir,
    file: join(dir, "settings.json"),
    backup: join(dir, "settings.json.backup"),
  };
}

function isSettings(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readSettingsFile(path: string, logger?: { warn(msg: string): void }): Promise<Settings | null> {
  if (!existsSync(path)) return null;
  const content = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    logger?.warn(`Failed to parse ${path}: ${String(err)}`);
    return null;
  }
  return isSettings(parsed) ? parsed : null;
}

export async function detectPatchState(options: DetectOptions): Promise<PatchResult> {
  const { logger } = options;
  const p = options.paths ?? defaultSettingsPaths();

  if (!existsSync(p.backup)) {
    return { patched: false };
  }

  try {
    const settings = await readSettingsFile(p.file, logger);
    const url = settings?.env?.ANTHROPIC_BASE_URL;
    if (url) {
      const port = extractLocalhostPort(url);
      if (port !== undefined) {
        return { patched: true, port };
      }
    }
  } catch (err) {
    logger.warn(`Could not read settings.json to extract port: ${String(err)}`);
  }

  // Backup exists, so a restore is needed even if we can't read the current port.
  return { patched: true };
}

export async function patchClaudeSettings(options: PatchOptions): Promise<void> {
  const { logger } = options;
  const p = options.paths ?? defaultSettingsPaths();

  await mkdir(p.dir, { recursive: true });

  // Only back up once so a crash doesn't clobber the real original
  if (existsSync(p.file) && !existsSync(p.backup)) {
    await copyFile(p.file, p.backup);
  }

  let settings: Settings = {};
  try {
    settings = await readSettingsFile(p.file, logger) ?? {};
  } catch (err) {
    logger.warn(`Could not read settings.json, starting fresh: ${String(err)}`);
  }

  settings.env = {
    ...settings.env,
    ANTHROPIC_BASE_URL: `http://localhost:${String(options.port)}`,
    ANTHROPIC_AUTH_TOKEN: options.authToken ?? DUMMY_AUTH_TOKEN,
  };

  await writeFile(p.file, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

export async function restoreClaudeSettings(options: RestoreOptions): Promise<void> {
  const p = options.paths ?? defaultSettingsPaths();

  // Best-effort: log and continue so restore completes as much as possible.
  try {
    if (existsSync(p.file)) {
      await unlink(p.file);
    }
  } catch (err) {
    options.logger.warn(`Failed to remove patched settings: ${String(err)}`);
  }

  try {
    if (existsSync(p.backup)) {
      await rename(p.backup, p.file);
    }
  } catch (err) {
    options.logger.warn(`Failed to restore backup settings: ${String(err)}`);
  }
}
