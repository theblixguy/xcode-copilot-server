export { PROVIDER_NAMES } from "copilot-sdk-proxy";
import type { ProviderName } from "copilot-sdk-proxy";

export const UA_PREFIXES: Record<ProviderName, string> = {
  openai: "Xcode/",
  claude: "claude-cli/",
  codex: "Xcode/",
};
