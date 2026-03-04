import { describe, it, expect } from "vitest";
import { PROVIDER_NAMES, UA_PREFIXES } from "../../src/providers/names.js";

describe("PROVIDER_NAMES", () => {
  it("contains all three providers", () => {
    expect(PROVIDER_NAMES).toEqual(["openai", "claude", "codex"]);
  });
});

describe("UA_PREFIXES", () => {
  it("has an entry for each provider", () => {
    for (const name of PROVIDER_NAMES) {
      expect(UA_PREFIXES[name]).toBeDefined();
      expect(typeof UA_PREFIXES[name]).toBe("string");
    }
  });

  it("claude prefix starts with claude-cli/", () => {
    expect(UA_PREFIXES.claude).toBe("claude-cli/");
  });

  it("openai and codex use the Xcode prefix", () => {
    expect(UA_PREFIXES.openai).toBe("Xcode/");
    expect(UA_PREFIXES.codex).toBe("Xcode/");
  });
});
