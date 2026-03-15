import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { dim } from "copilot-sdk-proxy";
import type { Logger } from "copilot-sdk-proxy";
import type { ProviderName, ProviderMode } from "copilot-sdk-proxy";

const AGENTS_DIR = join(
  homedir(),
  "Library/Developer/Xcode/CodingAssistant/Agents/Versions",
);

const AGENT_BINARY_NAMES: Partial<Record<ProviderName, string>> = {
  claude: "claude",
  codex: "codex",
};

function findAgentBinary(proxy: ProviderName, logger?: Logger): string | null {
  const binaryName = AGENT_BINARY_NAMES[proxy];
  if (!binaryName) return null;

  if (!existsSync(AGENTS_DIR)) return null;

  let versions: string[];
  try {
    versions = readdirSync(AGENTS_DIR);
  } catch (err) {
    logger?.debug(`Failed to read agents directory: ${String(err)}`);
    return null;
  }

  for (const version of versions) {
    const binaryPath = join(AGENTS_DIR, version, binaryName);
    if (existsSync(binaryPath)) return binaryPath;
  }
  return null;
}

export interface ProxyBannerInfo {
  providerName: string;
  proxyFlag: ProviderMode;
  routes: string[];
  cwd: string;
  autoPatch?: boolean | undefined;
  logger?: Logger | undefined;
}

export function printProxyBanner(info: ProxyBannerInfo): void {
  const providerHint =
    info.proxyFlag === "auto" ? "" : ` ${dim(`(--proxy ${info.proxyFlag})`)}`;

  const lines = [
    "",
    `  ${dim("Provider")}   ${info.providerName}${providerHint}`,
    `  ${dim("Routes")}     ${info.routes.join(dim(", "))}`,
    `  ${dim("Directory")}  ${info.cwd}`,
  ];

  if (info.autoPatch) {
    lines.push(`  ${dim("Auto-patch")} enabled`);
  }

  if (info.proxyFlag !== "auto") {
    const binaryName = AGENT_BINARY_NAMES[info.proxyFlag];
    if (binaryName) {
      const agentPath = findAgentBinary(info.proxyFlag, info.logger);
      lines.push(
        agentPath
          ? `  ${dim("Agent")}      ${agentPath}`
          : `  ${dim("Agent")}      ${dim(`not found (expected at ${AGENTS_DIR}/<version>/${binaryName})`)}`,
      );
    }
  }
  lines.push("");

  console.log(lines.join("\n"));
}
