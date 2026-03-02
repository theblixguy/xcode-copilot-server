import type { Logger } from "copilot-sdk-proxy";
import type { ProxyName, ProxyMode } from "../providers/index.js";
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

export async function patchAll(port: number, logger: Logger): Promise<void> {
  for (const patcher of Object.values(patcherByProxy)) {
    await patcher.patch({ port, logger });
  }
}

export async function restoreAll(logger: Logger): Promise<void> {
  for (const patcher of Object.values(patcherByProxy)) {
    try {
      await patcher.restore({ logger });
    } catch (err) {
      logger.error(`Failed to restore settings: ${String(err)}`);
    }
  }
}

export async function patchSettings(proxy: ProxyMode | null, port: number, logger: Logger): Promise<void> {
  if (proxy === "auto" || !proxy) {
    await patchAll(port, logger);
  } else {
    const patcher = patcherByProxy[proxy];
    if (patcher) await patcher.patch({ port, logger });
  }
}

export async function restoreSettings(proxy: ProxyMode | null, logger: Logger): Promise<void> {
  if (proxy === "auto" || !proxy) {
    await restoreAll(logger);
  } else {
    const patcher = patcherByProxy[proxy];
    if (patcher) {
      try {
        await patcher.restore({ logger });
      } catch (err) {
        logger.error(`Failed to restore settings: ${String(err)}`);
      }
    }
  }
}
