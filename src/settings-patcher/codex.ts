// Config.toml doesn't work here because the built-in "openai" provider
// always takes priority over custom [model_providers.openai] entries:
// https://github.com/openai/codex/blob/abeafbdca17f6102099ac5b792761b6883c52d35/codex-rs/core/src/config/mod.rs#L1544
//
// So we set OPENAI_BASE_URL via launchctl instead, that way Xcode (and
// any Codex process it spawns) can see it without a shell restart.

import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "../logger.js";
import type { PatchResult } from "./types.js";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (cmd: string, args: string[]) => Promise<string>;

async function defaultExec(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args);
  return stdout;
}

interface EnvBackup {
  OPENAI_BASE_URL: string | null;
  OPENAI_API_KEY: string | null;
}

export function defaultCodexBackupPath(): string {
  return join(
    homedir(),
    "Library/Developer/Xcode/CodingAssistant/codex",
    "env.backup.json",
  );
}

async function launchctlGetenv(exec: ExecFn, name: string): Promise<string | null> {
  try {
    const value = (await exec("launchctl", ["getenv", name])).trim();
    return value || null;
  } catch {
    return null;
  }
}

export interface CodexPatchOptions {
  port: number;
  logger: Logger;
  exec?: ExecFn;
  backupFile?: string;
}

export interface CodexRestoreOptions {
  logger: Logger;
  exec?: ExecFn;
  backupFile?: string;
}

export interface CodexDetectOptions {
  logger: Logger;
  exec?: ExecFn;
  backupFile?: string;
}

export async function detectCodexPatchState(options: CodexDetectOptions): Promise<PatchResult> {
  const { logger } = options;
  const exec = options.exec ?? defaultExec;
  const backupFile = options.backupFile ?? defaultCodexBackupPath();

  if (!existsSync(backupFile)) {
    return { patched: false };
  }

  try {
    const url = await launchctlGetenv(exec, "OPENAI_BASE_URL");
    if (url) {
      const match = /localhost:(\d+)/.exec(url);
      if (match?.[1]) {
        return { patched: true, port: parseInt(match[1], 10) };
      }
    }
  } catch (err) {
    logger.warn(`Could not read OPENAI_BASE_URL: ${String(err)}`);
  }

  return { patched: true };
}

export async function patchCodexSettings(options: CodexPatchOptions): Promise<void> {
  const { port } = options;
  const exec = options.exec ?? defaultExec;
  const backupFile = options.backupFile ?? defaultCodexBackupPath();

  const baseUrl = `http://localhost:${String(port)}/v1`;

  // Only back up once so a crash doesn't clobber the real originals
  if (!existsSync(backupFile)) {
    const backup: EnvBackup = {
      OPENAI_BASE_URL: await launchctlGetenv(exec, "OPENAI_BASE_URL"),
      OPENAI_API_KEY: await launchctlGetenv(exec, "OPENAI_API_KEY"),
    };
    const dir = join(backupFile, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(backupFile, JSON.stringify(backup, null, 2) + "\n", "utf-8");
  }

  await exec("launchctl", ["setenv", "OPENAI_BASE_URL", baseUrl]);
  await exec("launchctl", ["setenv", "OPENAI_API_KEY", "xcode-copilot"]);
}

export async function restoreCodexSettings(options: CodexRestoreOptions): Promise<void> {
  const { logger } = options;
  const exec = options.exec ?? defaultExec;
  const backupFile = options.backupFile ?? defaultCodexBackupPath();

  if (!existsSync(backupFile)) {
    // No backup found, just unset to be safe
    try {
      await exec("launchctl", ["unsetenv", "OPENAI_BASE_URL"]);
      await exec("launchctl", ["unsetenv", "OPENAI_API_KEY"]);
    } catch (err) {
      logger.warn(`Failed to unset env vars: ${String(err)}`);
    }
    return;
  }

  try {
    const raw = await readFile(backupFile, "utf-8");
    const backup = JSON.parse(raw) as EnvBackup;

    if (backup.OPENAI_BASE_URL != null) {
      await exec("launchctl", ["setenv", "OPENAI_BASE_URL", backup.OPENAI_BASE_URL]);
    } else {
      await exec("launchctl", ["unsetenv", "OPENAI_BASE_URL"]);
    }

    if (backup.OPENAI_API_KEY != null) {
      await exec("launchctl", ["setenv", "OPENAI_API_KEY", backup.OPENAI_API_KEY]);
    } else {
      await exec("launchctl", ["unsetenv", "OPENAI_API_KEY"]);
    }

    await unlink(backupFile);
    logger.info("Restored env vars from backup");
  } catch (err) {
    logger.warn(`Failed to restore env vars: ${String(err)}`);
    // Restore failed, just try to unset both
    try {
      await exec("launchctl", ["unsetenv", "OPENAI_BASE_URL"]);
      await exec("launchctl", ["unsetenv", "OPENAI_API_KEY"]);
    } catch (unsetErr) {
      logger.warn(`Failed to unset env vars during recovery: ${String(unsetErr)}`);
    }
  }
}
