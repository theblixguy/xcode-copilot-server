export const LEVEL_PRIORITY = {
  none: 0,
  error: 1,
  warning: 2,
  info: 3,
  debug: 4,
  all: 5,
} as const satisfies Record<string, number>;

export type LogLevel = keyof typeof LEVEL_PRIORITY;

export class Logger {
  readonly level: LogLevel;
  private threshold: number;

  constructor(level: LogLevel = "info") {
    this.level = level;
    this.threshold = LEVEL_PRIORITY[level];
  }

  error(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.error) {
      console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`, ...args);
    }
  }

  warn(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.warning) {
      console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`, ...args);
    }
  }

  info(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.info) {
      console.log(`[${new Date().toISOString()}] [INFO] ${msg}`, ...args);
    }
  }

  debug(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.debug) {
      console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`, ...args);
    }
  }
}
