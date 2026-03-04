import type { Logger } from "copilot-sdk-proxy";
import type { ExecFn } from "../utils/child-process.js";

export interface SettingsPaths {
  dir: string;
  file: string;
  backup: string;
}

export interface Settings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface PatchResult {
  patched: boolean;
  port?: number;
}

// Errors: log warnings on recoverable failures, throw on unrecoverable I/O errors.
export interface SettingsPatcher {
  detect(options: DetectOptions): Promise<PatchResult>;
  patch(options: { port: number; logger: Logger }): Promise<void>;
  restore(options: { logger: Logger }): Promise<void>;
}

interface BaseOptions {
  logger: Logger;
  paths?: SettingsPaths;
}

export interface PatchOptions extends BaseOptions {
  port: number;
  authToken?: string;
}

export type RestoreOptions = BaseOptions;
export type DetectOptions = BaseOptions;

// Codex uses launchctl env vars instead of files, so its options differ
interface CodexBaseOptions {
  logger: Logger;
  exec?: ExecFn;
  backupFile?: string;
}

export interface CodexPatchOptions extends CodexBaseOptions {
  port: number;
}
export type CodexRestoreOptions = CodexBaseOptions;
export type CodexDetectOptions = CodexBaseOptions;
