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

export function defaultSettingsPaths(): SettingsPaths {
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

async function readSettingsFile(path: string): Promise<Settings | null> {
  if (!existsSync(path)) return null;
  const content = await readFile(path, "utf-8");
  const parsed: unknown = JSON.parse(content);
  return isSettings(parsed) ? parsed : null;
}

export async function detectPatchState(options: DetectOptions): Promise<PatchResult> {
  const { logger } = options;
  const p = options.paths ?? defaultSettingsPaths();

  if (!existsSync(p.backup)) {
    return { patched: false };
  }

  try {
    const settings = await readSettingsFile(p.file);
    const url = settings?.env?.ANTHROPIC_BASE_URL;
    if (url) {
      const match = /localhost:(\d+)/.exec(url);
      if (match?.[1]) {
        return { patched: true, port: parseInt(match[1], 10) };
      }
    }
  } catch (err) {
    logger.warn(`Could not read settings.json to extract port: ${String(err)}`);
  }

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
    settings = await readSettingsFile(p.file) ?? {};
  } catch (err) {
    logger.warn(`Could not read settings.json, starting fresh: ${String(err)}`);
  }

  settings.env = {
    ...settings.env,
    ANTHROPIC_BASE_URL: `http://localhost:${String(options.port)}`,
    ANTHROPIC_AUTH_TOKEN: options.authToken ?? "12345",
  };

  await writeFile(p.file, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

export async function restoreClaudeSettings(options: RestoreOptions): Promise<void> {
  const p = options.paths ?? defaultSettingsPaths();

  if (existsSync(p.file)) {
    await unlink(p.file);
  }

  if (existsSync(p.backup)) {
    await rename(p.backup, p.file);
  }
}
