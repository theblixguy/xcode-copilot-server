import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createSpinner, printBanner, printUsageSummary, symbols, type BannerInfo } from "../src/ui.js";
import type { StatsSnapshot } from "../src/stats.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_RE, "");

describe("symbols", () => {
  it("contains expected symbol characters", () => {
    expect(strip(symbols.success)).toBe("✓");
    expect(strip(symbols.error)).toBe("✗");
    expect(strip(symbols.info)).toBe("●");
    expect(strip(symbols.warn)).toBe("!");
    expect(strip(symbols.debug)).toBe("·");
  });
});

describe("createSpinner", () => {
  let writeSpy: MockInstance;
  let writeErrSpy: MockInstance;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    writeErrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    process.stdout.isTTY = originalIsTTY as boolean;
    vi.restoreAllMocks();
  });

  it("returns an object with update, succeed, fail, stop methods", () => {
    process.stdout.isTTY = false;
    const spinner = createSpinner("test");
    expect(typeof spinner.update).toBe("function");
    expect(typeof spinner.succeed).toBe("function");
    expect(typeof spinner.fail).toBe("function");
    expect(typeof spinner.stop).toBe("function");
  });

  describe("non-TTY fallback", () => {
    beforeEach(() => {
      process.stdout.isTTY = false;
    });

    it("prints initial text on creation", () => {
      createSpinner("Loading...");
      const output = strip(String(writeSpy.mock.calls[0]?.[0] ?? ""));
      expect(output).toContain("Loading...");
    });

    it("succeed writes success symbol and text", () => {
      const spinner = createSpinner("test");
      writeSpy.mockClear();
      spinner.succeed("Done!");
      const output = strip(String(writeSpy.mock.calls[0]?.[0] ?? ""));
      expect(output).toContain("✓");
      expect(output).toContain("Done!");
    });

    it("fail writes error symbol and text to stderr", () => {
      const spinner = createSpinner("test");
      spinner.fail("Failed!");
      const output = strip(String(writeErrSpy.mock.calls[0]?.[0] ?? ""));
      expect(output).toContain("✗");
      expect(output).toContain("Failed!");
    });
  });

  describe("TTY mode", () => {
    beforeEach(() => {
      process.stdout.isTTY = true;
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("succeed clears interval and writes success text", () => {
      const spinner = createSpinner("Loading...");
      writeSpy.mockClear();
      spinner.succeed("All done!");
      const output = strip(
        writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(""),
      );
      expect(output).toContain("✓");
      expect(output).toContain("All done!");
    });

    it("fail clears interval and writes error text to stderr", () => {
      const spinner = createSpinner("Loading...");
      spinner.fail("Oops!");
      const output = strip(
        writeErrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(""),
      );
      expect(output).toContain("✗");
      expect(output).toContain("Oops!");
    });

    it("stop clears without writing a final message", () => {
      const spinner = createSpinner("Loading...");
      writeSpy.mockClear();
      spinner.stop();
      const output = writeSpy.mock.calls.map((c: unknown[]) => strip(String(c[0]))).join("");
      expect(output).not.toContain("✓");
      expect(output).not.toContain("✗");
    });
  });
});

describe("printBanner", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const info: BannerInfo = {
    port: 8080,
    proxy: "openai",
    providerName: "OpenAI",
    routes: ["GET /v1/models", "POST /v1/chat/completions"],
    cwd: "/Users/test/project",
    autoPatch: false,
  };

  it("prints provider, routes, and directory", () => {
    printBanner(info);
    const output = logSpy.mock.calls.map((c: unknown[]) => strip(String(c[0]))).join("\n");
    expect(output).toContain("OpenAI");
    expect(output).toContain("--proxy openai");
    expect(output).toContain("GET /v1/models");
    expect(output).toContain("POST /v1/chat/completions");
    expect(output).toContain("/Users/test/project");
  });

  it("does not show auto-patch when disabled", () => {
    printBanner(info);
    const output = logSpy.mock.calls.map((c: unknown[]) => strip(String(c[0]))).join("\n");
    expect(output).not.toContain("Auto-patch");
  });

  it("shows auto-patch when enabled", () => {
    printBanner({ ...info, autoPatch: true });
    const output = logSpy.mock.calls.map((c: unknown[]) => strip(String(c[0]))).join("\n");
    expect(output).toContain("Auto-patch");
    expect(output).toContain("enabled");
  });
});

describe("printUsageSummary", () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseSnap: StatsSnapshot = {
    requests: 0,
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    apiDurationMs: 0,
    errors: 0,
    uptimeMs: 5000,
    modelMetrics: {},
  };

  const allOutput = () =>
    logSpy.mock.calls.map((c: unknown[]) => strip(String(c[0]))).join("\n");

  it("prints header, requests, sessions, and uptime", () => {
    printUsageSummary({ ...baseSnap, requests: 42, sessions: 3 });
    const output = allOutput();
    expect(output).toContain("Usage Summary");
    expect(output).toContain("42");
    expect(output).toContain("3");
    expect(output).toContain("5s");
  });

  it("prints token breakdown when tokens are present", () => {
    printUsageSummary({
      ...baseSnap,
      inputTokens: 1500,
      outputTokens: 500,
    });
    const output = allOutput();
    expect(output).toContain("1.5k input");
    expect(output).toContain("500 output");
  });

  it("prints cache tokens when present", () => {
    printUsageSummary({
      ...baseSnap,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 2000,
      cacheWriteTokens: 300,
    });
    const output = allOutput();
    expect(output).toContain("2.0k cache read");
    expect(output).toContain("300 cache write");
  });

  it("omits token line when all token counts are zero", () => {
    printUsageSummary(baseSnap);
    const output = allOutput();
    expect(output).not.toContain("Tokens");
  });

  it("prints cost when present", () => {
    printUsageSummary({ ...baseSnap, totalCost: 1.50 });
    const output = allOutput();
    expect(output).toContain("$1.50");
  });

  it("formats small costs with extra precision", () => {
    printUsageSummary({ ...baseSnap, totalCost: 0.005 });
    const output = allOutput();
    expect(output).toContain("$0.0050");
  });

  it("omits cost line when cost is zero", () => {
    printUsageSummary(baseSnap);
    const output = allOutput();
    expect(output).not.toContain("Cost");
  });

  it("prints errors when present", () => {
    printUsageSummary({ ...baseSnap, errors: 5 });
    const output = allOutput();
    expect(output).toContain("5");
    expect(output).toContain("Errors");
  });

  it("omits errors line when count is zero", () => {
    printUsageSummary(baseSnap);
    const output = allOutput();
    expect(output).not.toContain("Errors");
  });

  it("prints API time when present", () => {
    printUsageSummary({ ...baseSnap, apiDurationMs: 125_000 });
    const output = allOutput();
    expect(output).toContain("2m 5s");
  });

  it("omits API time when zero", () => {
    printUsageSummary(baseSnap);
    const output = allOutput();
    expect(output).not.toContain("API time");
  });

  it("prints per-model breakdown", () => {
    printUsageSummary({
      ...baseSnap,
      modelMetrics: {
        "gpt-4": {
          requests: 10,
          cost: 0.50,
          inputTokens: 5000,
          outputTokens: 2000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        "claude-3": {
          requests: 1,
          cost: 0.002,
          inputTokens: 300,
          outputTokens: 100,
          cacheReadTokens: 1000,
          cacheWriteTokens: 0,
        },
      },
    });
    const output = allOutput();
    expect(output).toContain("By model:");
    expect(output).toContain("gpt-4");
    expect(output).toContain("10 calls");
    expect(output).toContain("$0.50");
    expect(output).toContain("claude-3");
    expect(output).toContain("1 call");
    expect(output).toContain("1.0k cached");
  });

  it("formats uptime with hours when applicable", () => {
    printUsageSummary({ ...baseSnap, uptimeMs: 3_661_000 });
    const output = allOutput();
    expect(output).toContain("1h 1m 1s");
  });

  it("formats large token counts with M suffix", () => {
    printUsageSummary({
      ...baseSnap,
      inputTokens: 1_500_000,
      outputTokens: 100,
    });
    const output = allOutput();
    expect(output).toContain("1.5M input");
  });
});
