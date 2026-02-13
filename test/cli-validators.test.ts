import { describe, it, expect } from "vitest";
import {
  parsePort,
  parseLogLevel,
  parseProxy,
  validateAutoPatch,
} from "../src/cli-validators.js";

describe("parsePort", () => {
  it("parses a valid port", () => {
    expect(parsePort("8080")).toBe(8080);
  });

  it("accepts port 1", () => {
    expect(parsePort("1")).toBe(1);
  });

  it("accepts port 65535", () => {
    expect(parsePort("65535")).toBe(65535);
  });

  it("throws on port 0", () => {
    expect(() => parsePort("0")).toThrow('Invalid port "0"');
  });

  it("throws on port above 65535", () => {
    expect(() => parsePort("65536")).toThrow('Invalid port "65536"');
  });

  it("throws on negative port", () => {
    expect(() => parsePort("-1")).toThrow('Invalid port "-1"');
  });

  it("throws on non-numeric string", () => {
    expect(() => parsePort("abc")).toThrow('Invalid port "abc"');
  });

  it("throws on empty string", () => {
    expect(() => parsePort("")).toThrow('Invalid port ""');
  });

  it("truncates floating point to integer", () => {
    expect(parsePort("80.5")).toBe(80);
  });
});

describe("parseLogLevel", () => {
  it.each(["none", "error", "warning", "info", "debug", "all"] as const)(
    "accepts %s",
    (level) => {
      expect(parseLogLevel(level)).toBe(level);
    },
  );

  it("throws on invalid level", () => {
    expect(() => parseLogLevel("verbose")).toThrow('Invalid log level "verbose"');
  });

  it("throws on empty string", () => {
    expect(() => parseLogLevel("")).toThrow('Invalid log level ""');
  });
});

describe("parseProxy", () => {
  it("accepts openai", () => {
    expect(parseProxy("openai")).toBe("openai");
  });

  it("accepts anthropic", () => {
    expect(parseProxy("anthropic")).toBe("anthropic");
  });

  it("throws on invalid proxy", () => {
    expect(() => parseProxy("gemini")).toThrow('Invalid proxy "gemini"');
  });

  it("throws on empty string", () => {
    expect(() => parseProxy("")).toThrow('Invalid proxy ""');
  });
});

describe("validateAutoPatch", () => {
  it("allows auto-patch with anthropic", () => {
    expect(() => { validateAutoPatch("anthropic", true); }).not.toThrow();
  });

  it("throws when auto-patch is used with openai", () => {
    expect(() => { validateAutoPatch("openai", true); }).toThrow(
      "--auto-patch can only be used with --proxy anthropic",
    );
  });

  it("allows no auto-patch with openai", () => {
    expect(() => { validateAutoPatch("openai", false); }).not.toThrow();
  });

  it("allows no auto-patch with anthropic", () => {
    expect(() => { validateAutoPatch("anthropic", false); }).not.toThrow();
  });
});
