// Config.toml doesn't work here because the built-in "openai" provider
// always takes priority over custom [model_providers.openai] entries:
// https://github.com/openai/codex/blob/abeafbdca17f6102099ac5b792761b6883c52d35/codex-rs/core/src/config/mod.rs#L1544
//
// So we set OPENAI_BASE_URL via launchctl instead, that way Xcode (and
// any Codex process it spawns) can see it without a shell restart.

import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "copilot-sdk-proxy";
import type { PatchResult, CodexPatchOptions, CodexRestoreOptions, CodexDetectOptions } from "./types.js";
import { extractLocalhostPort } from "./url-utils.js";
import { defaultExec, type ExecFn } from "../utils/child-process.js";
import { isRecord } from "../utils/type-guards.js";

interface EnvBackup {
  OPENAI_BASE_URL: string | null;
  OPENAI_API_KEY: string | null;
}

function isEnvBackup(value: unknown): value is EnvBackup {
  if (!isRecord(value)) return false;
  return (
    ("OPENAI_BASE_URL" in value && (typeof value.OPENAI_BASE_URL === "string" || value.OPENAI_BASE_URL === null)) &&
    ("OPENAI_API_KEY" in value && (typeof value.OPENAI_API_KEY === "string" || value.OPENAI_API_KEY === null))
  );
}

function defaultCodexBackupPath(): string {
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
    // launchctl exits non-zero when the env var is unset, that's expected
    return null;
  }
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
      const port = extractLocalhostPort(url);
      if (port !== undefined) {
        return { patched: true, port };
      }
    }
  } catch (err) {
    logger.warn(`Could not read OPENAI_BASE_URL: ${String(err)}`);
  }

  // Backup exists, so a restore is needed even if we can't read the current port.
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

  // Let exec errors propagate. The caller (patchSettings) decides how to handle them.
  await exec("launchctl", ["setenv", "OPENAI_BASE_URL", baseUrl]);
  await exec("launchctl", ["setenv", "OPENAI_API_KEY", "xcode-copilot"]);
}

async function unsetEnvVars(exec: ExecFn, logger: Logger): Promise<void> {
  try {
    await exec("launchctl", ["unsetenv", "OPENAI_BASE_URL"]);
    await exec("launchctl", ["unsetenv", "OPENAI_API_KEY"]);
  } catch (err) {
    logger.warn(`Failed to unset env vars: ${String(err)}`);
  }
}

async function readEnvBackup(backupFile: string, logger: Logger): Promise<EnvBackup | null> {
  if (!existsSync(backupFile)) return null;

  const raw = await readFile(backupFile, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn("Backup file contains invalid JSON, unsetting env vars");
    return null;
  }
  if (!isEnvBackup(parsed)) {
    logger.warn("Backup file has unexpected shape, unsetting env vars");
    return null;
  }
  return parsed;
}

export async function restoreCodexSettings(options: CodexRestoreOptions): Promise<void> {
  const { logger } = options;
  const exec = options.exec ?? defaultExec;
  const backupFile = options.backupFile ?? defaultCodexBackupPath();

  const backup = await readEnvBackup(backupFile, logger);
  if (!backup) {
    await unsetEnvVars(exec, logger);
    return;
  }

  // Best-effort: restore as many env vars as possible.
  try {
    if (backup.OPENAI_BASE_URL != null) {
      await exec("launchctl", ["setenv", "OPENAI_BASE_URL", backup.OPENAI_BASE_URL]);
    } else {
      await exec("launchctl", ["unsetenv", "OPENAI_BASE_URL"]);
    }
  } catch (err) {
    logger.warn(`Failed to restore OPENAI_BASE_URL: ${String(err)}`);
  }

  try {
    if (backup.OPENAI_API_KEY != null) {
      await exec("launchctl", ["setenv", "OPENAI_API_KEY", backup.OPENAI_API_KEY]);
    } else {
      await exec("launchctl", ["unsetenv", "OPENAI_API_KEY"]);
    }
  } catch (err) {
    logger.warn(`Failed to restore OPENAI_API_KEY: ${String(err)}`);
  }

  try {
    await unlink(backupFile);
  } catch (err) {
    logger.warn(`Failed to remove backup file: ${String(err)}`);
  }
  logger.info("Restored env vars from backup");
}
