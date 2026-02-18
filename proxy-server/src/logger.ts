import { bold, dim, red, yellow, cyan, symbols } from "./ui.js";

export const LEVEL_PRIORITY = {
  none: 0,
  error: 1,
  warning: 2,
  info: 3,
  debug: 4,
  all: 5,
} as const satisfies Record<string, number>;

export type LogLevel = keyof typeof LEVEL_PRIORITY;

const LEVEL_STYLE = {
  error: { label: red(bold("ERROR")), symbol: symbols.error },
  warn: { label: yellow(bold("WARN")), symbol: symbols.warn },
  info: { label: cyan("INFO"), symbol: symbols.info },
  debug: { label: dim("DEBUG"), symbol: symbols.debug },
} as const;

export class Logger {
  readonly level: LogLevel;
  private threshold: number;

  // Status line needs to clear/redraw around log output
  onBeforeLog?: (() => void) | undefined;
  onAfterLog?: (() => void) | undefined;

  constructor(level: LogLevel = "info") {
    this.level = level;
    this.threshold = LEVEL_PRIORITY[level];
  }

  error(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.error) {
      const { label, symbol } = LEVEL_STYLE.error;
      this.onBeforeLog?.();
      console.error(`${dim(new Date().toISOString())} ${symbol} ${label} ${msg}`, ...args);
      this.onAfterLog?.();
    }
  }

  warn(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.warning) {
      const { label, symbol } = LEVEL_STYLE.warn;
      this.onBeforeLog?.();
      console.warn(`${dim(new Date().toISOString())} ${symbol} ${label} ${msg}`, ...args);
      this.onAfterLog?.();
    }
  }

  info(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.info) {
      const { label, symbol } = LEVEL_STYLE.info;
      this.onBeforeLog?.();
      console.log(`${dim(new Date().toISOString())} ${symbol} ${label} ${msg}`, ...args);
      this.onAfterLog?.();
    }
  }

  debug(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.debug) {
      const { label, symbol } = LEVEL_STYLE.debug;
      this.onBeforeLog?.();
      console.log(`${dim(new Date().toISOString())} ${symbol} ${label} ${dim(msg)}`, ...args);
      this.onAfterLog?.();
    }
  }
}
