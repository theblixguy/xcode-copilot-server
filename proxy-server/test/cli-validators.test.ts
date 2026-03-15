import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { parseProvider, validateAutoPatch } from "../src/cli-validators.js";

describe("parseProvider", () => {
  it("accepts openai", () => {
    expect(parseProvider("openai")).toBe("openai");
  });

  it("accepts claude", () => {
    expect(parseProvider("claude")).toBe("claude");
  });

  it("accepts codex", () => {
    expect(parseProvider("codex")).toBe("codex");
  });

  it("throws on invalid proxy", () => {
    expect(() => parseProvider("gemini")).toThrow('Invalid proxy "gemini"');
  });

  it("throws on empty string", () => {
    expect(() => parseProvider("")).toThrow('Invalid proxy ""');
  });
});

describe("validateAutoPatch", () => {
  it("allows auto-patch with claude", () => {
    expect(() => {
      validateAutoPatch("claude", true);
    }).not.toThrow();
  });

  it("allows auto-patch with codex", () => {
    expect(() => {
      validateAutoPatch("codex", true);
    }).not.toThrow();
  });

  it("throws when auto-patch is used with openai", () => {
    expect(() => {
      validateAutoPatch("openai", true);
    }).toThrow("--auto-patch is only supported for: claude, codex");
  });

  it("allows no auto-patch with openai", () => {
    expect(() => {
      validateAutoPatch("openai", false);
    }).not.toThrow();
  });

  it("allows no auto-patch with claude", () => {
    expect(() => {
      validateAutoPatch("claude", false);
    }).not.toThrow();
  });

  it("allows no auto-patch with codex", () => {
    expect(() => {
      validateAutoPatch("codex", false);
    }).not.toThrow();
  });
});

describe("subcommand option pass-through", () => {
  function buildProgram(): {
    program: Command;
    captured: Record<string, Record<string, string>>;
  } {
    const captured: Record<string, Record<string, string>> = {};

    const program = new Command()
      .enablePositionalOptions()
      .passThroughOptions()
      .option("--proxy <provider>", "API format", "openai")
      .option("--idle-timeout <minutes>", "idle timeout", "0")
      .action((opts: Record<string, string>) => {
        captured["main"] = opts;
      });

    program
      .command("install-agent")
      .option("--proxy <provider>", "API format", "openai")
      .option("--idle-timeout <minutes>", "idle timeout", "60")
      .option("--auto-patch")
      .action((opts: Record<string, string>) => {
        captured["install-agent"] = opts;
      });

    return { program, captured };
  }

  it("routes --proxy to the subcommand, not the parent", async () => {
    const { program, captured } = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "install-agent",
      "--proxy",
      "claude",
    ]);

    expect(captured["install-agent"]!.proxy).toBe("claude");
  });

  it("routes --idle-timeout to the subcommand", async () => {
    const { program, captured } = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "install-agent",
      "--idle-timeout",
      "30",
    ]);

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
