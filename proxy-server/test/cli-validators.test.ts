import { describe, it, expect } from "vitest";
import { Command } from "commander";
import {
  parsePort,
  parseLogLevel,
  parseProxy,
  parseIdleTimeout,
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

  it("accepts claude", () => {
    expect(parseProxy("claude")).toBe("claude");
  });

  it("accepts codex", () => {
    expect(parseProxy("codex")).toBe("codex");
  });

  it("throws on invalid proxy", () => {
    expect(() => parseProxy("gemini")).toThrow('Invalid proxy "gemini"');
  });

  it("throws on empty string", () => {
    expect(() => parseProxy("")).toThrow('Invalid proxy ""');
  });
});

describe("parseIdleTimeout", () => {
  it("parses a valid timeout", () => {
    expect(parseIdleTimeout("60")).toBe(60);
  });

  it("accepts zero (disabled)", () => {
    expect(parseIdleTimeout("0")).toBe(0);
  });

  it("throws on negative value", () => {
    expect(() => parseIdleTimeout("-1")).toThrow('Invalid idle timeout "-1"');
  });

  it("throws on non-numeric value", () => {
    expect(() => parseIdleTimeout("abc")).toThrow('Invalid idle timeout "abc"');
  });

  it("throws on empty string", () => {
    expect(() => parseIdleTimeout("")).toThrow('Invalid idle timeout ""');
  });

  it("truncates floating point to integer", () => {
    expect(parseIdleTimeout("3.5")).toBe(3);
  });
});

describe("validateAutoPatch", () => {
  it("allows auto-patch with claude", () => {
    expect(() => { validateAutoPatch("claude", true); }).not.toThrow();
  });

  it("allows auto-patch with codex", () => {
    expect(() => { validateAutoPatch("codex", true); }).not.toThrow();
  });

  it("throws when auto-patch is used with openai", () => {
    expect(() => { validateAutoPatch("openai", true); }).toThrow(
      "--auto-patch can only be used with --proxy claude or --proxy codex",
    );
  });

  it("allows no auto-patch with openai", () => {
    expect(() => { validateAutoPatch("openai", false); }).not.toThrow();
  });

  it("allows no auto-patch with claude", () => {
    expect(() => { validateAutoPatch("claude", false); }).not.toThrow();
  });

  it("allows no auto-patch with codex", () => {
    expect(() => { validateAutoPatch("codex", false); }).not.toThrow();
  });
});

describe("subcommand option pass-through", () => {
  function buildProgram(): { program: Command; captured: Record<string, Record<string, string>> } {
    const captured: Record<string, Record<string, string>> = {};

    const program = new Command()
      .enablePositionalOptions()
      .passThroughOptions()
      .option("--proxy <provider>", "API format", "openai")
      .option("--idle-timeout <minutes>", "idle timeout", "0")
      .action((opts: Record<string, string>) => { captured["main"] = opts; });

    program
      .command("install-agent")
      .option("--proxy <provider>", "API format", "openai")
      .option("--idle-timeout <minutes>", "idle timeout", "60")
      .option("--auto-patch")
      .action((opts: Record<string, string>) => { captured["install-agent"] = opts; });

    return { program, captured };
  }

  it("routes --proxy to the subcommand, not the parent", async () => {
    const { program, captured } = buildProgram();
    await program.parseAsync(["node", "test", "install-agent", "--proxy", "claude"]);

    expect(captured["install-agent"]!.proxy).toBe("claude");
  });

  it("routes --idle-timeout to the subcommand", async () => {
    const { program, captured } = buildProgram();
    await program.parseAsync(["node", "test", "install-agent", "--idle-timeout", "30"]);

    expect(captured["install-agent"]!.idleTimeout).toBe("30");
  });

  it("routes --proxy to the parent when no subcommand is used", async () => {
    const { program, captured } = buildProgram();
    await program.parseAsync(["node", "test", "--proxy", "claude"]);

    expect(captured["main"]!.proxy).toBe("claude");
  });

  it("subcommand uses its own default when parent option is not passed", async () => {
    const { program, captured } = buildProgram();
    await program.parseAsync(["node", "test", "install-agent"]);

    expect(captured["install-agent"]!.idleTimeout).toBe("60");
  });
});
