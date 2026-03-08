import { parsePort, parseLogLevel, parseIdleTimeout, PROVIDER_NAMES, isProviderName } from "copilot-sdk-proxy";
import type { ProviderName, ProviderMode } from "copilot-sdk-proxy";

export { parsePort, parseLogLevel, parseIdleTimeout, isProviderName };

export function parseProvider(value: string): ProviderName {
  if (!isProviderName(value)) {
    throw new Error(
      `Invalid proxy "${value}". Valid: ${PROVIDER_NAMES.join(", ")}`,
    );
  }
  return value;
}

export function parseProviderMode(value: string): ProviderMode {
  if (value === "auto") return "auto";
  return parseProvider(value);
}

const PATCHABLE_PROXIES: ReadonlySet<string> = new Set(["claude", "codex"]);

export function validateAutoPatch(proxy: ProviderName, autoPatch: boolean): void {
  if (autoPatch && !PATCHABLE_PROXIES.has(proxy)) {
    throw new Error(
      `--auto-patch is only supported for: ${[...PATCHABLE_PROXIES].join(", ")}`,
    );
  }
}
