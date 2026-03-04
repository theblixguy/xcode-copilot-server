import type { Logger } from "copilot-sdk-proxy";
import type { ProxyName, ProxyMode } from "../providers/index.js";
import type { SettingsPatcher } from "./types.js";
import { detectPatchState, patchClaudeSettings, restoreClaudeSettings } from "./claude.js";
import { detectCodexPatchState, patchCodexSettings, restoreCodexSettings } from "./codex.js";

export const patcherByProxy: Partial<Record<ProxyName, SettingsPatcher>> = {
  claude: { detect: detectPatchState, patch: patchClaudeSettings, restore: restoreClaudeSettings },
  codex: { detect: detectCodexPatchState, patch: patchCodexSettings, restore: restoreCodexSettings },
};

function resolvePatchers(proxy: ProxyMode | null) {
  if (proxy === "auto" || !proxy) return Object.values(patcherByProxy);
  const p = patcherByProxy[proxy];
  return p ? [p] : [];
}

export async function patchSettings(proxy: ProxyMode | null, port: number, logger: Logger): Promise<void> {
  for (const patcher of resolvePatchers(proxy)) {
    await patcher.patch({ port, logger });
  }
}

// Best-effort: continue restoring other providers if one fails.
export async function restoreSettings(proxy: ProxyMode | null, logger: Logger): Promise<void> {
  for (const patcher of resolvePatchers(proxy)) {
    try {
      await patcher.restore({ logger });
    } catch (err) {
      logger.error(`Failed to restore settings: ${String(err)}`);
    }
  }
}
