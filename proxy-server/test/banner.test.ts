import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printProxyBanner, type ProxyBannerInfo } from "../src/banner.js";

describe("printProxyBanner", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base: ProxyBannerInfo = {
    providerName: "Claude",
    proxyFlag: "claude",
    routes: ["/v1/messages"],
    cwd: "/tmp/test",
  };

  it("prints provider, routes, and directory", () => {
    printProxyBanner(base);
    const output = lines.join("\n");
    expect(output).toContain("Claude");
    expect(output).toContain("--proxy claude");
    expect(output).toContain("/v1/messages");
    expect(output).toContain("/tmp/test");
  });

  it("shows auto-patch line when enabled", () => {
    printProxyBanner({ ...base, autoPatch: true });
    const output = lines.join("\n");
    expect(output).toContain("Auto-patch");
    expect(output).toContain("enabled");
  });

  it("hides auto-patch line when disabled", () => {
    printProxyBanner({ ...base, autoPatch: false });
    const output = lines.join("\n");
    expect(output).not.toContain("Auto-patch");
  });

  it("hides auto-patch line when omitted", () => {
    printProxyBanner(base);
    const output = lines.join("\n");
    expect(output).not.toContain("Auto-patch");
  });

  it("shows agent line for provider with a known binary name", () => {
    printProxyBanner({ ...base, proxyFlag: "claude" });
    const output = lines.join("\n");
    expect(output).toContain("Agent");
  });

  it("hides agent line for auto mode", () => {
    printProxyBanner({ ...base, proxyFlag: "auto" });
    const output = lines.join("\n");
    expect(output).not.toContain("Agent");
  });

  it("hides agent line for openai provider", () => {
    printProxyBanner({ ...base, proxyFlag: "openai" });
    const output = lines.join("\n");
    expect(output).not.toContain("Agent");
  });

  it("joins multiple routes", () => {
    printProxyBanner({
      ...base,
      routes: ["/v1/messages", "/v1/chat/completions"],
    });
    const output = lines.join("\n");
    expect(output).toContain("/v1/messages");
    expect(output).toContain("/v1/chat/completions");
  });
});
