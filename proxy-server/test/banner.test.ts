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

  it("shows agent path when found", () => {
    printProxyBanner({
      ...base,
      agentBinaryName: "claude",
      agentPath: "/path/to/claude",
    });
    const output = lines.join("\n");
    expect(output).toContain("Agent");
    expect(output).toContain("/path/to/claude");
  });

  it("shows agent not-found message when binary expected but not found", () => {
    printProxyBanner({
      ...base,
      agentBinaryName: "claude",
      agentPath: null,
      agentsDir: "/Library/Agents",
    });
    const output = lines.join("\n");
    expect(output).toContain("not found");
    expect(output).toContain("/Library/Agents");
    expect(output).toContain("claude");
  });

  it("hides agent line when no binary name", () => {
    printProxyBanner(base);
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
