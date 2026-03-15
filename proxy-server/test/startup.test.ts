import { describe, it, expect } from "vitest";
import { parseOptions, type StartOptions } from "../src/startup.js";

function baseOptions(overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    port: "8080",
    logLevel: "none",
    version: "1.0.0",
    defaultConfigPath: "/default/config.json5",
    ...overrides,
  };
}

describe("parseOptions", () => {
  it("returns defaults for minimal options", () => {
    const result = parseOptions(baseOptions());
    expect(result.port).toBe(8080);
    expect(result.proxyMode).toBe("auto");
    expect(result.logLevel).toBe("none");
    expect(result.launchdMode).toBe(false);
    expect(result.idleTimeoutMinutes).toBe(0);
    expect(result.cwd).toBeUndefined();
  });

  it("parses port as number", () => {
    const result = parseOptions(baseOptions({ port: "3000" }));
    expect(result.port).toBe(3000);
  });

  it("sets proxyMode from proxy option", () => {
    const result = parseOptions(baseOptions({ proxy: "claude" }));
    expect(result.proxyMode).toBe("claude");
  });

  it("enables launchd mode", () => {
    const result = parseOptions(baseOptions({ launchd: true }));
    expect(result.launchdMode).toBe(true);
    expect(result.quiet).toBe(true);
  });

  it("sets quiet when log level is none", () => {
    const result = parseOptions(baseOptions({ logLevel: "none" }));
    expect(result.quiet).toBe(true);
  });

  it("parses idle timeout", () => {
    const result = parseOptions(baseOptions({ idleTimeout: "30" }));
    expect(result.idleTimeoutMinutes).toBe(30);
  });

  describe("shouldPatch", () => {
    it("enables auto-patch in auto mode (non-launchd)", () => {
      const result = parseOptions(baseOptions());
      expect(result.shouldPatch).toBe(true);
    });

    it("disables auto-patch in auto mode with launchd", () => {
      const result = parseOptions(baseOptions({ launchd: true }));
      expect(result.shouldPatch).toBe(false);
    });

    it("disables auto-patch for explicit provider without flag", () => {
      const result = parseOptions(baseOptions({ proxy: "claude" }));
      expect(result.shouldPatch).toBe(false);
    });

    it("enables auto-patch for explicit provider with flag", () => {
      const result = parseOptions(
        baseOptions({ proxy: "claude", autoPatch: true }),
      );
      expect(result.shouldPatch).toBe(true);
    });

    it("disables auto-patch for explicit provider with launchd even if flag set", () => {
      const result = parseOptions(
        baseOptions({ proxy: "claude", autoPatch: true, launchd: true }),
      );
      expect(result.shouldPatch).toBe(false);
    });
  });

  describe("configPath", () => {
    it("uses explicit config path when provided", () => {
      const result = parseOptions(baseOptions({ config: "/my/config.json5" }));
      expect(result.configPath).toBe("/my/config.json5");
    });

    it("resolves a config path when not specified", () => {
      const result = parseOptions(baseOptions());
      expect(result.configPath).toContain("config.json5");
    });
  });
});
