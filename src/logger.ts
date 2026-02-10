export const LEVEL_PRIORITY = {
  none: 0,
  error: 1,
  warning: 2,
  info: 3,
  debug: 4,
  all: 5,
} as const satisfies Record<string, number>;

export type LogLevel = keyof typeof LEVEL_PRIORITY;

export function formatCompaction(data: unknown): string {
  if (!data || typeof data !== "object") return "compaction data unavailable";
  const cd = data as Record<string, unknown>;
<<<<<<< HEAD
  return `${String(cd["preCompactionTokens"])} to ${String(cd["postCompactionTokens"])} tokens`;
=======
  return `${String(cd["preCompactionTokens"])} \u2192 ${String(cd["postCompactionTokens"])} tokens`;
>>>>>>> 892438e (Move session-config up a level, add new config options, clean up comments)
}

export class Logger {
  readonly level: LogLevel;
  private threshold: number;

  constructor(level: LogLevel = "info") {
    this.level = level;
    this.threshold = LEVEL_PRIORITY[level];
  }

  error(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.error) {
      console.error(`[ERROR] ${msg}`, ...args);
    }
  }

  warn(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.warning) {
      console.warn(`[WARN] ${msg}`, ...args);
    }
  }

  info(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.info) {
      console.log(`[INFO] ${msg}`, ...args);
    }
  }

  debug(msg: string, ...args: unknown[]): void {
    if (this.threshold >= LEVEL_PRIORITY.debug) {
      console.log(`[DEBUG] ${msg}`, ...args);
    }
  }
}
