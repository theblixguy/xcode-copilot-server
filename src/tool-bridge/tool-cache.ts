import type { AnthropicToolDefinition } from "../schemas/anthropic.js";

export class ToolCache {
  private cachedTools: AnthropicToolDefinition[] = [];

  cacheTools(tools: AnthropicToolDefinition[]): void {
    this.cachedTools = tools;
  }

  getCachedTools(): AnthropicToolDefinition[] {
    return this.cachedTools;
  }

  // The model sometimes hallucinates shortened tool names like "XcodeRead"
  // so we resolve them against the cached list to match what Xcode sent.
  resolveToolName(name: string): string {
    if (this.cachedTools.some((t) => t.name === name)) return name;

    const suffix = `__${name}`;
    const matches = this.cachedTools.filter((t) => t.name.endsWith(suffix));
    if (matches.length === 1 && matches[0]) return matches[0].name;

    return name;
  }
}
