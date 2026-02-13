import pc from "picocolors";
import readline from "node:readline";

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
