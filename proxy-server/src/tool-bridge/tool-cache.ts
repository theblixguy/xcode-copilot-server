import type { AnthropicToolDefinition } from "copilot-sdk-proxy";

// The Copilot model likes to rename CLI-style flags to camelCase, so we
// need a lookup for the ones that can't be derived automatically.
const FLAG_ALIASES: ReadonlyMap<string, string> = new Map([
  ["ignoreCase", "-i"],
  ["caseInsensitive", "-i"],
  ["lineNumbers", "-n"],
  ["showLineNumbers", "-n"],
  ["afterContext", "-A"],
  ["linesAfter", "-A"],
  ["beforeContext", "-B"],
  ["linesBefore", "-B"],
]);

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface SchemaProperty {
  enum?: string[];
  [key: string]: unknown;
}

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

  // The Copilot model doesn't always respect the exact property names or
  // enum values in tool schemas, e.g. "ignoreCase" instead of "-i",
  // "outputMode" instead of "output_mode", "filesWithMatches" instead of
  // "files_with_matches". We remap these against the actual schema so the
  // downstream executor doesn't reject them with InputValidationError.
  normalizeArgs(
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const tool = this.cachedTools.find((t) => t.name === toolName);
    const props = (tool?.input_schema as { properties?: Record<string, SchemaProperty> } | undefined)?.properties;
    if (!props) return args;

    const schemaKeys = new Set(Object.keys(props));
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const resolvedKey = this.resolveKey(key, schemaKeys);
      result[resolvedKey] = this.resolveValue(value, props[resolvedKey]);
    }

    return result;
  }

  private resolveKey(key: string, schemaKeys: Set<string>): string {
    if (schemaKeys.has(key)) return key;

    const snake = camelToSnake(key);
    if (schemaKeys.has(snake)) return snake;

    const camel = snakeToCamel(key);
    if (schemaKeys.has(camel)) return camel;

    const alias = FLAG_ALIASES.get(key);
    if (alias && schemaKeys.has(alias)) return alias;

    return key;
  }

  private resolveValue(value: unknown, schemaProp: SchemaProperty | undefined): unknown {
    if (typeof value !== "string" || !schemaProp?.enum) return value;
    if (schemaProp.enum.includes(value)) return value;

    // e.g. "filesWithMatches" becomes "files_with_matches"
    const snake = camelToSnake(value);
    if (schemaProp.enum.includes(snake)) return snake;

    return value;
  }
}
