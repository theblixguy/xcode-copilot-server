export const PROVIDER_NAMES = ["openai", "claude", "codex"] as const;

export type ProxyName = (typeof PROVIDER_NAMES)[number];
export type ProxyMode = ProxyName | "auto";

export const UA_PREFIXES: Record<ProxyName, string> = {
  openai: "Xcode/",
  claude: "claude-cli/",
  codex: "Xcode/",
};
