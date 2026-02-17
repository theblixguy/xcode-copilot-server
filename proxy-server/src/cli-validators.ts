import { LEVEL_PRIORITY, type LogLevel } from "./logger.js";
import { providers, type ProxyName } from "./providers/index.js";

const VALID_LOG_LEVELS = Object.keys(LEVEL_PRIORITY) as LogLevel[];
const VALID_PROXIES = Object.keys(providers) as ProxyName[];

function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_PRIORITY;
}

export function isProxyName(value: string): value is ProxyName {
  return value in providers;
}

export function parsePort(value: string): number {
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${value}". Must be 1-65535.`);
  }
  return port;
}

export function parseLogLevel(value: string): LogLevel {
  if (!isLogLevel(value)) {
    throw new Error(
      `Invalid log level "${value}". Valid: ${VALID_LOG_LEVELS.join(", ")}`,
    );
  }
  return value;
}

export function parseProxy(value: string): ProxyName {
  if (!isProxyName(value)) {
    throw new Error(
      `Invalid proxy "${value}". Valid: ${VALID_PROXIES.join(", ")}`,
    );
  }
  return value;
}

export function parseIdleTimeout(value: string): number {
  const minutes = parseInt(value, 10);
  if (isNaN(minutes) || minutes < 0) {
    throw new Error(`Invalid idle timeout "${value}". Must be a non-negative integer (minutes).`);
  }
  return minutes;
}

export function validateAutoPatch(proxy: ProxyName, autoPatch: boolean): void {
  if (autoPatch && proxy !== "claude" && proxy !== "codex") {
    throw new Error("--auto-patch can only be used with --proxy claude or --proxy codex");
  }
}
