import type { Logger } from "copilot-sdk-proxy";

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
