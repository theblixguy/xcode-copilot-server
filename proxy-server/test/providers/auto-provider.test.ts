import { describe, it, expect } from "vitest";
import { providers, createAutoProvider } from "../../src/providers/index.js";
import { DEFAULT_CONFIG } from "../../src/config-schema.js";

describe("providers", () => {
  it("has openai, claude, and codex providers", () => {
    expect(providers.openai).toBeDefined();
    expect(providers.claude).toBeDefined();
    expect(providers.codex).toBeDefined();
  });

  it("each provider has name and routes", () => {
    for (const [key, provider] of Object.entries(providers)) {
      expect(provider.name, `${key} should have a name`).toBeTruthy();
      expect(provider.routes.length, `${key} should have routes`).toBeGreaterThan(0);
    }
  });
});

describe("createAutoProvider", () => {
  it("returns an Auto provider", () => {
    const configs = {
      openai: DEFAULT_CONFIG,
      claude: DEFAULT_CONFIG,
      codex: DEFAULT_CONFIG,
    };
    const auto = createAutoProvider(configs);
    expect(auto.name).toBe("Auto");
  });

  it("combines routes from all providers", () => {
    const configs = {
      openai: DEFAULT_CONFIG,
      claude: DEFAULT_CONFIG,
      codex: DEFAULT_CONFIG,
    };
    const auto = createAutoProvider(configs);

    const allRoutes = [
      ...providers.openai.routes,
      ...providers.claude.routes,
      ...providers.codex.routes,
    ];
    expect(auto.routes).toEqual(allRoutes);
  });
});
