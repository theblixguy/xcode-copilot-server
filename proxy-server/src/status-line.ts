import readline from "node:readline";
import { dim } from "./ui.js";
import type { StatsSnapshot } from "./stats.js";

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds)}s`;
  return `${String(seconds)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function buildContent(snap: StatsSnapshot): string {
  const parts: string[] = [];

  parts.push(`${String(snap.requests)} request${snap.requests !== 1 ? "s" : ""}`);

  if (snap.inputTokens > 0 || snap.outputTokens > 0) {
    parts.push(`${formatTokenCount(snap.inputTokens)} in`);
    parts.push(`${formatTokenCount(snap.outputTokens)} out`);
  }

  if (snap.cacheReadTokens > 0) {
    parts.push(`${formatTokenCount(snap.cacheReadTokens)} cached`);
  }

  if (snap.totalCost > 0) {
    parts.push(formatCost(snap.totalCost));
  }

  parts.push(`${formatUptime(snap.uptimeMs)} uptime`);

  return parts.join(dim(" │ "));
}

// ANSI codes mess up width calculations for right-alignment
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// When visible, cursor sits above the status line so log output goes in the right place.
// clearLine() and redraw() both maintain this — the status is 1 line below the cursor.

export class StatusLine {
  private lastContent = "";
  private visible = false;
  private resizeHandler: (() => void) | null = null;

  constructor() {
    this.resizeHandler = () => {
      this.clearLine();
      this.redraw();
    };
    process.stdout.on("resize", this.resizeHandler);
  }

  clearLine(): void {
    if (!this.visible) return;
    readline.moveCursor(process.stdout, 0, 1);
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    readline.moveCursor(process.stdout, 0, -1);
    this.visible = false;
  }

  update(snap: StatsSnapshot): void {
    this.lastContent = buildContent(snap);
    this.clearLine();
    this.redraw();
  }

  redraw(): void {
    if (!this.lastContent) return;

    const cols = process.stdout.columns;
    const visibleLen = stripAnsi(this.lastContent).length;
    const pad = Math.max(0, cols - visibleLen - 2);

    process.stdout.write(`\n${" ".repeat(pad)}${dim(this.lastContent)}`);
    // Put cursor back above so log output lands in the right spot
    readline.moveCursor(process.stdout, 0, -1);
    readline.cursorTo(process.stdout, 0);
    this.visible = true;
  }

  clear(): void {
    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    if (!this.visible) return;
    this.clearLine();
    this.visible = false;
    this.lastContent = "";
  }
}
