import type { Logger } from "copilot-sdk-proxy";
import type { ProxyName } from "../providers/index.js";
import { patchClaudeSettings, restoreClaudeSettings } from "./claude.js";
import { patchCodexSettings, restoreCodexSettings } from "./codex.js";

export type {
  SettingsPaths,
  Settings,
  PatchResult,
  PatchOptions,
  RestoreOptions,
  DetectOptions,
} from "./types.js";

export {
  defaultSettingsPaths,
  detectPatchState,
  patchClaudeSettings,
  restoreClaudeSettings,
} from "./claude.js";

export type {
  ExecFn,
  CodexPatchOptions,
  CodexRestoreOptions,
  CodexDetectOptions,
} from "./codex.js";

export {
  defaultCodexBackupPath,
  detectCodexPatchState,
  patchCodexSettings,
  restoreCodexSettings,
} from "./codex.js";

export const patcherByProxy: Partial<Record<ProxyName, {
  patch: (opts: { port: number; logger: Logger }) => Promise<void>;
  restore: (opts: { logger: Logger }) => Promise<void>;
}>> = {
  claude: { patch: patchClaudeSettings, restore: restoreClaudeSettings },
  codex: { patch: patchCodexSettings, restore: restoreCodexSettings },
};
