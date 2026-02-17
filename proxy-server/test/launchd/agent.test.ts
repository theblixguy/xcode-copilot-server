import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import plistLib from "plist";
import { Logger } from "../../src/logger.js";
import {
  generatePlist,
  parsePlistArgs,
  installAgent,
  uninstallAgent,
  AGENT_LABEL,
  type ExecFn,
  type PlistOptions,
} from "../../src/launchd/index.js";

const logger = new Logger("none");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "launchd-agent-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function defaultPlistOptions(): PlistOptions {
  return {
    nodePath: "/usr/local/bin/node",
    entryPoint: "/opt/server/dist/index.js",
    port: 8080,
    proxy: "openai",
    logLevel: "info",
  };
}

interface ParsedPlist {
  Label: string;
  ProgramArguments: string[];
  Sockets: { Listeners: Record<string, string> };
  StandardOutPath: string;
  StandardErrorPath: string;
  EnvironmentVariables?: Record<string, string>;
}

function parsePlist(xml: string): ParsedPlist {
  return plistLib.parse(xml) as unknown as ParsedPlist;
}

describe("generatePlist", () => {
  it("generates valid plist with correct Label", () => {
    const parsed = parsePlist(generatePlist(defaultPlistOptions()));

    expect(parsed.Label).toBe(AGENT_LABEL);
  });

  it("ProgramArguments includes --launchd flag automatically", () => {
    const parsed = parsePlist(generatePlist(defaultPlistOptions()));

    expect(parsed.ProgramArguments).toContain("--launchd");
  });

  it("ProgramArguments includes all provided options", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      proxy: "claude",
      port: 9090,
      logLevel: "debug",
    }));

    const args = parsed.ProgramArguments;
    expect(args[args.indexOf("--proxy") + 1]).toBe("claude");
    expect(args[args.indexOf("--port") + 1]).toBe("9090");
    expect(args[args.indexOf("--log-level") + 1]).toBe("debug");
  });

  it("includes --config when specified", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      config: "/path/to/config.json5",
    }));

    const args = parsed.ProgramArguments;
    expect(args[args.indexOf("--config") + 1]).toBe("/path/to/config.json5");
  });

  it("includes --cwd when specified", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      cwd: "/path/to/cwd",
    }));

    const args = parsed.ProgramArguments;
    expect(args[args.indexOf("--cwd") + 1]).toBe("/path/to/cwd");
  });

  it("includes --auto-patch when specified", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      autoPatch: true,
    }));

    expect(parsed.ProgramArguments).toContain("--auto-patch");
  });

  it("does not include --auto-patch when false", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      autoPatch: false,
    }));

    expect(parsed.ProgramArguments).not.toContain("--auto-patch");
  });

  it("includes --idle-timeout when specified", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      idleTimeout: 30,
    }));

    const args = parsed.ProgramArguments;
    expect(args).toContain("--idle-timeout");
    expect(args[args.indexOf("--idle-timeout") + 1]).toBe("30");
  });

  it("does not include --idle-timeout when zero", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      idleTimeout: 0,
    }));

    expect(parsed.ProgramArguments).not.toContain("--idle-timeout");
  });

  it("does not include --idle-timeout when not specified", () => {
    const parsed = parsePlist(generatePlist(defaultPlistOptions()));

    expect(parsed.ProgramArguments).not.toContain("--idle-timeout");
  });

  it("Sockets.Listeners uses correct port and 127.0.0.1", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      port: 3000,
    }));

    const listeners = parsed.Sockets.Listeners;
    expect(listeners).toEqual({
      SockServiceName: "3000",
      SockNodeName: "127.0.0.1",
      SockFamily: "IPv4",
      SockType: "stream",
    });
  });

  it("includes EnvironmentVariables when provided", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      environmentVariables: {
        GITHUB_TOKEN: "ghp_test123",
        PATH: "/usr/bin",
      },
    }));

    expect(parsed.EnvironmentVariables).toBeDefined();
    expect(parsed.EnvironmentVariables!["GITHUB_TOKEN"]).toBe("ghp_test123");
    expect(parsed.EnvironmentVariables!["PATH"]).toBe("/usr/bin");
  });

  it("auto-includes PATH from process.env", () => {
    const originalPath = process.env["PATH"];
    process.env["PATH"] = "/test/path";

    try {
      const parsed = parsePlist(generatePlist(defaultPlistOptions()));
      expect(parsed.EnvironmentVariables!["PATH"]).toBe("/test/path");
    } finally {
      process.env["PATH"] = originalPath;
    }
  });

  it("auto-includes GITHUB_TOKEN from process.env when set", () => {
    const original = process.env["GITHUB_TOKEN"];
    process.env["GITHUB_TOKEN"] = "ghp_from_env";

    try {
      const parsed = parsePlist(generatePlist(defaultPlistOptions()));
      expect(parsed.EnvironmentVariables!["GITHUB_TOKEN"]).toBe("ghp_from_env");
    } finally {
      if (original === undefined) {
        delete process.env["GITHUB_TOKEN"];
      } else {
        process.env["GITHUB_TOKEN"] = original;
      }
    }
  });

  it("uses absolute paths for node binary and entry point", () => {
    const parsed = parsePlist(generatePlist(defaultPlistOptions()));

    expect(parsed.ProgramArguments[0]).toBe("/usr/local/bin/node");
    expect(parsed.ProgramArguments[1]).toBe("/opt/server/dist/index.js");
  });

  it("round-trips XML special characters in values", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      cwd: "/path/with <special> & chars",
    }));

    const args = parsed.ProgramArguments;
    expect(args[args.indexOf("--cwd") + 1]).toBe("/path/with <special> & chars");
  });

  it("includes log paths", () => {
    const parsed = parsePlist(generatePlist({
      ...defaultPlistOptions(),
      logPaths: { out: "/tmp/out.log", err: "/tmp/err.log" },
    }));

    expect(parsed.StandardOutPath).toBe("/tmp/out.log");
    expect(parsed.StandardErrorPath).toBe("/tmp/err.log");
  });
});

describe("parsePlistArgs", () => {
  it("extracts --proxy value from ProgramArguments", () => {
    const xml = generatePlist({
      ...defaultPlistOptions(),
      proxy: "claude",
    });
    const parsed = parsePlistArgs(xml);
    expect(parsed.proxy).toBe("claude");
  });

  it("extracts --auto-patch boolean from ProgramArguments", () => {
    const xml = generatePlist({
      ...defaultPlistOptions(),
      autoPatch: true,
    });
    const parsed = parsePlistArgs(xml);
    expect(parsed.autoPatch).toBe(true);
  });

  it("returns autoPatch false when not present", () => {
    const xml = generatePlist(defaultPlistOptions());
    const parsed = parsePlistArgs(xml);
    expect(parsed.autoPatch).toBe(false);
  });

  it("handles missing ProgramArguments gracefully", () => {
    const parsed = parsePlistArgs("<plist><dict></dict></plist>");
    expect(parsed.proxy).toBeNull();
    expect(parsed.autoPatch).toBe(false);
  });

  it("handles completely invalid XML gracefully", () => {
    const parsed = parsePlistArgs("this is not xml");
    expect(parsed.proxy).toBeNull();
    expect(parsed.autoPatch).toBe(false);
  });

  it("handles ProgramArguments with fewer than two elements", () => {
    const xml = plistLib.build({ ProgramArguments: ["/usr/bin/node"] });
    const parsed = parsePlistArgs(xml);
    expect(parsed.proxy).toBeNull();
    expect(parsed.autoPatch).toBe(false);
  });

  it("handles all proxy values", () => {
    for (const proxy of ["openai", "claude", "codex"] as const) {
      const xml = generatePlist({ ...defaultPlistOptions(), proxy });
      const parsed = parsePlistArgs(xml);
      expect(parsed.proxy).toBe(proxy);
    }
  });
});

function createMockExec(): { exec: ExecFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const exec: ExecFn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return Promise.resolve("");
  };
  return { exec, calls };
}

function createMockExecFailingUnload(): { exec: ExecFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const exec: ExecFn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    if (args[0] === "unload") {
      return Promise.reject(new Error("Could not find specified service"));
    }
    return Promise.resolve("");
  };
  return { exec, calls };
}

describe("installAgent", () => {
  it("writes plist to the specified path", async () => {
    const plistPath = join(tempDir, "test.plist");
    const mock = createMockExec();

    await installAgent({
      port: 8080,
      proxy: "openai",
      logLevel: "info",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
    });

    expect(existsSync(plistPath)).toBe(true);
    const parsed = parsePlist(readFileSync(plistPath, "utf-8"));
    expect(parsed.Label).toBe(AGENT_LABEL);
  });

  it("calls launchctl load with the plist path", async () => {
    const plistPath = join(tempDir, "test.plist");
    const mock = createMockExec();

    await installAgent({
      port: 8080,
      proxy: "openai",
      logLevel: "info",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
    });

    const loadCall = mock.calls.find((c) => c.args[0] === "load");
    expect(loadCall).toBeDefined();
    expect(loadCall!.cmd).toBe("launchctl");
    expect(loadCall!.args).toEqual(["load", plistPath]);
  });

  it("calls launchctl unload before load when plist already exists", async () => {
    const plistPath = join(tempDir, "test.plist");
    writeFileSync(plistPath, "<plist/>");
    const mock = createMockExec();

    await installAgent({
      port: 8080,
      proxy: "openai",
      logLevel: "info",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
    });

    const unloadIdx = mock.calls.findIndex((c) => c.args[0] === "unload");
    const loadIdx = mock.calls.findIndex((c) => c.args[0] === "load");
    expect(unloadIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeGreaterThan(unloadIdx);
  });

  it("ignores launchctl unload error on first install", async () => {
    const plistPath = join(tempDir, "test.plist");
    writeFileSync(plistPath, "<plist/>");
    const mock = createMockExecFailingUnload();

    await installAgent({
      port: 8080,
      proxy: "openai",
      logLevel: "info",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
    });

    expect(existsSync(plistPath)).toBe(true);
    const loadCall = mock.calls.find((c) => c.args[0] === "load");
    expect(loadCall).toBeDefined();
  });

  it("does not include --auto-patch in plist when not set", async () => {
    const plistPath = join(tempDir, "test.plist");
    const mock = createMockExec();

    await installAgent({
      port: 8080,
      proxy: "openai",
      logLevel: "info",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
      autoPatch: false,
    });

    const parsed = parsePlist(readFileSync(plistPath, "utf-8"));
    expect(parsed.ProgramArguments).not.toContain("--auto-patch");
  });

  it("includes --auto-patch in plist when enabled", async () => {
    const plistPath = join(tempDir, "test.plist");
    const mock = createMockExec();

    await installAgent({
      port: 8080,
      proxy: "openai",
      logLevel: "info",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
      autoPatch: true,
    });

    const parsed = parsePlist(readFileSync(plistPath, "utf-8"));
    expect(parsed.ProgramArguments).toContain("--auto-patch");
  });

  it("re-install updates the plist content", async () => {
    const plistPath = join(tempDir, "test.plist");
    const mock = createMockExec();

    await installAgent({
      port: 8080,
      proxy: "openai",
      logLevel: "info",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
    });

    const first = parsePlist(readFileSync(plistPath, "utf-8"));
    const firstArgs = first.ProgramArguments;
    expect(firstArgs[firstArgs.indexOf("--port") + 1]).toBe("8080");

    await installAgent({
      port: 9090,
      proxy: "claude",
      logLevel: "debug",
      logger,
      exec: mock.exec,
      plistPath,
      nodePath: "/usr/bin/node",
      entryPoint: "/opt/dist/index.js",
    });

    const second = parsePlist(readFileSync(plistPath, "utf-8"));
    const secondArgs = second.ProgramArguments;
    expect(secondArgs[secondArgs.indexOf("--port") + 1]).toBe("9090");
    expect(secondArgs[secondArgs.indexOf("--proxy") + 1]).toBe("claude");
    expect(secondArgs[secondArgs.indexOf("--log-level") + 1]).toBe("debug");
  });
});

describe("uninstallAgent", () => {
  it("calls launchctl unload with the plist path", async () => {
    const plistPath = join(tempDir, "test.plist");
    writeFileSync(plistPath, generatePlist(defaultPlistOptions()));
    const mock = createMockExec();

    await uninstallAgent({ logger, exec: mock.exec, plistPath });

    const unloadCall = mock.calls.find((c) => c.args[0] === "unload");
    expect(unloadCall).toBeDefined();
    expect(unloadCall!.args).toEqual(["unload", plistPath]);
  });

  it("deletes the plist file", async () => {
    const plistPath = join(tempDir, "test.plist");
    writeFileSync(plistPath, generatePlist(defaultPlistOptions()));
    const mock = createMockExec();

    await uninstallAgent({ logger, exec: mock.exec, plistPath });

    expect(existsSync(plistPath)).toBe(false);
  });

  it("detects --proxy value from existing plist", async () => {
    const plistPath = join(tempDir, "test.plist");
    writeFileSync(plistPath, generatePlist({
      ...defaultPlistOptions(),
      proxy: "claude",
    }));
    const mock = createMockExec();

    await uninstallAgent({ logger, exec: mock.exec, plistPath });
    expect(existsSync(plistPath)).toBe(false);
  });

  it("throws when no plist exists", async () => {
    const plistPath = join(tempDir, "nonexistent.plist");
    const mock = createMockExec();

    await expect(
      uninstallAgent({ logger, exec: mock.exec, plistPath }),
    ).rejects.toThrow("No launchd agent found");
  });

  it("handles launchctl unload failure gracefully", async () => {
    const plistPath = join(tempDir, "test.plist");
    writeFileSync(plistPath, generatePlist(defaultPlistOptions()));
    const mock = createMockExecFailingUnload();

    await uninstallAgent({ logger, exec: mock.exec, plistPath });

    expect(existsSync(plistPath)).toBe(false);
  });
});
