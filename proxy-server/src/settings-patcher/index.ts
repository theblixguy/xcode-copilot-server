import type { Logger } from "copilot-sdk-proxy";
import type { ProviderName, ProviderMode } from "copilot-sdk-proxy";
import type { SettingsPatcher } from "./types.js";
import {
  detectPatchState,
  patchClaudeSettings,
  restoreClaudeSettings,
} from "./claude.js";
import {
  detectCodexPatchState,
  patchCodexSettings,
  restoreCodexSettings,
} from "./codex.js";

export const patcherByProxy: Partial<Record<ProviderName, SettingsPatcher>> = {
  claude: {
    detect: detectPatchState,
    patch: patchClaudeSettings,
    restore: restoreClaudeSettings,
  },
  codex: {
    detect: detectCodexPatchState,
    patch: patchCodexSettings,
    restore: restoreCodexSettings,
  },
};

function resolvePatchers(proxy: ProviderMode | null) {
  if (proxy === "auto" || !proxy) return Object.values(patcherByProxy);
  const p = patcherByProxy[proxy];
  return p ? [p] : [];
}

export async function patchSettings(
  proxy: ProviderMode | null,
  port: number,
  logger: Logger,
): Promise<void> {
  for (const patcher of resolvePatchers(proxy)) {
    await patcher.patch({ port, logger });
  }
}

// Best-effort: continue restoring other providers if one fails.
export async function restoreSettings(
  proxy: ProviderMode | null,
  logger: Logger,
): Promise<void> {
  for (const patcher of resolvePatchers(proxy)) {
    try {
      await patcher.restore({ logger });
    } catch (err) {
      logger.error(`Failed to restore settings: ${String(err)}`);
    }
  }
}
