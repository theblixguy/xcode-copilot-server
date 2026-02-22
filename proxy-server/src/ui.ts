import pc from "picocolors";
import readline from "node:readline";
import type { StatsSnapshot } from "./stats.js";

export const bold = pc.bold;
export const dim = pc.dim;
export const red = pc.red;
export const green = pc.green;
export const cyan = pc.cyan;
export const yellow = pc.yellow;

export const symbols = {
  success: green("✓"),
  error: red("✗"),
  info: cyan("●"),
  warn: yellow("!"),
  debug: dim("·"),
} as const;

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const INTERVAL_MS = 80;

export interface Spinner {
  update(text: string): void;
  succeed(text: string): void;
  fail(text: string): void;
  stop(): void;
}

export function createSpinner(text: string): Spinner {
  if (!process.stdout.isTTY) {
    process.stdout.write(`  ${dim("...")} ${text}\n`);
    return {
      update() {},
      succeed(t: string) { process.stdout.write(`  ${symbols.success} ${t}\n`); },
      fail(t: string) { process.stderr.write(`  ${symbols.error} ${t}\n`); },
      stop() {},
    };
  }

  let frameIndex = 0;
  let current = text;

  const render = () => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    const frame = FRAMES[frameIndex] ?? FRAMES[0];
    process.stdout.write(`  ${cyan(frame)} ${current}`);
  };

  render();
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % FRAMES.length;
    render();
  }, INTERVAL_MS);

  const clear = () => {
    clearInterval(timer);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };

  return {
    update(t: string) { current = t; },
    succeed(t: string) { clear(); process.stdout.write(`  ${symbols.success} ${t}\n`); },
    fail(t: string) { clear(); process.stderr.write(`  ${symbols.error} ${t}\n`); },
    stop() { clear(); },
  };
}

export interface BannerInfo {
  port: number;
  proxy: string;
  providerName: string;
  routes: string[];
  cwd: string;
  autoPatch: boolean;
  agentBinary?: { found: true; path: string } | { found: false; expected: string };
}

export function printBanner(info: BannerInfo): void {
  console.log();
  console.log(`  ${dim("Provider")}   ${info.providerName} ${dim(`(--proxy ${info.proxy})`)}`);
  if (info.agentBinary) {
    if (info.agentBinary.found) {
      console.log(`  ${dim("Agent")}      ${info.agentBinary.path}`);
    } else {
      console.log(`  ${dim("Agent")}      ${yellow("not found")} ${dim(`(expected at ${info.agentBinary.expected})`)}`);
    }
  }
  console.log(`  ${dim("Routes")}     ${info.routes.join(dim(", "))}`);
  console.log(`  ${dim("Directory")}  ${info.cwd}`);
  if (info.autoPatch) {
    console.log(`  ${dim("Auto-patch")} ${green("enabled")}`);
  }
  console.log();
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${String(hours)}h ${String(minutes)}m ${String(seconds)}s`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds)}s`;
  return `${String(seconds)}s`;
}

export function printUsageSummary(snap: StatsSnapshot): void {
  const ruler = dim("─".repeat(40));
  console.log();
  console.log(`  ${dim("──")} ${bold("Usage Summary")} ${ruler}`);
  console.log(`  ${dim("Requests")}     ${formatNumber(snap.requests)}`);
  console.log(`  ${dim("Sessions")}     ${formatNumber(snap.sessions)}`);
  if (snap.errors > 0) {
    console.log(`  ${dim("Errors")}       ${red(formatNumber(snap.errors))}`);
  }
  if (snap.inputTokens > 0 || snap.outputTokens > 0) {
    const tokenParts = [
      `${formatTokens(snap.inputTokens)} input`,
      `${formatTokens(snap.outputTokens)} output`,
    ];
    if (snap.cacheReadTokens > 0) {
      tokenParts.push(`${formatTokens(snap.cacheReadTokens)} cache read`);
    }
    if (snap.cacheWriteTokens > 0) {
      tokenParts.push(`${formatTokens(snap.cacheWriteTokens)} cache write`);
    }
    console.log(`  ${dim("Tokens")}       ${tokenParts.join(dim(" │ "))}`);
  }
  if (snap.totalCost > 0) {
    const cost = snap.totalCost < 0.01
      ? `$${snap.totalCost.toFixed(4)}`
      : `$${snap.totalCost.toFixed(2)}`;
    console.log(`  ${dim("Cost")}         ${cost}`);
  }
  if (snap.apiDurationMs > 0) {
    console.log(`  ${dim("API time")}     ${formatDuration(snap.apiDurationMs)}`);
  }
  console.log(`  ${dim("Uptime")}       ${formatDuration(snap.uptimeMs)}`);

  const models = Object.entries(snap.modelMetrics);
  if (models.length > 0) {
    console.log();
    console.log(`  ${dim("By model:")}`);
    for (const [model, m] of models) {
      const parts = [`${formatNumber(m.requests)} call${m.requests !== 1 ? "s" : ""}`];
      parts.push(`${formatTokens(m.inputTokens)} in`);
      parts.push(`${formatTokens(m.outputTokens)} out`);
      if (m.cacheReadTokens > 0) parts.push(`${formatTokens(m.cacheReadTokens)} cached`);
      if (m.cost > 0) {
        const c = m.cost < 0.01 ? `$${m.cost.toFixed(4)}` : `$${m.cost.toFixed(2)}`;
        parts.push(c);
      }
      console.log(`  ${dim("  " + model)}  ${parts.join(dim(" │ "))}`);
    }
  }

  console.log(`  ${ruler}${dim("─".repeat(16))}`);
  console.log();
}
