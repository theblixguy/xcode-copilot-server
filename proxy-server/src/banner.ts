import { dim } from "copilot-sdk-proxy";

export interface ProxyBannerInfo {
  providerName: string;
  proxyFlag: string;
  routes: string[];
  cwd: string;
  autoPatch?: boolean | undefined;
  agentPath?: string | null | undefined;
  agentBinaryName?: string | undefined;
  agentsDir?: string | undefined;
}

export function printProxyBanner(info: ProxyBannerInfo): void {
  console.log();
  console.log(`  ${dim("Provider")}   ${info.providerName} ${dim(`(--proxy ${info.proxyFlag})`)}`);
  console.log(`  ${dim("Routes")}     ${info.routes.join(dim(", "))}`);
  console.log(`  ${dim("Directory")}  ${info.cwd}`);
  if (info.autoPatch) {
    console.log(`  ${dim("Auto-patch")} enabled`);
  }
  if (info.agentBinaryName) {
    if (info.agentPath) {
      console.log(`  ${dim("Agent")}      ${info.agentPath}`);
    } else {
      console.log(`  ${dim("Agent")}      ${dim(`not found (expected at ${info.agentsDir ?? ""}/<version>/${info.agentBinaryName})`)}`);
    }
  }
  console.log();
}
