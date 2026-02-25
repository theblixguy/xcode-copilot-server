import { parsePort, parseLogLevel, parseIdleTimeout } from "copilot-sdk-proxy";
import { providers, type ProxyName } from "./providers/index.js";

export { parsePort, parseLogLevel, parseIdleTimeout };
export type { ProxyName };

const VALID_PROXIES = Object.keys(providers) as ProxyName[];

export function isProxyName(value: string): value is ProxyName {
  return value in providers;
}

export function parseProxy(value: string): ProxyName {
  if (!isProxyName(value)) {
    throw new Error(
      `Invalid proxy "${value}". Valid: ${VALID_PROXIES.join(", ")}`,
    );
  }
  return value;
}

const PATCHABLE_PROXIES: ReadonlySet<string> = new Set(["claude", "codex"]);

export function validateAutoPatch(proxy: ProxyName, autoPatch: boolean): void {
  if (autoPatch && !PATCHABLE_PROXIES.has(proxy)) {
    throw new Error(
      `--auto-patch is only supported for: ${[...PATCHABLE_PROXIES].join(", ")}`,
    );
  }
}
