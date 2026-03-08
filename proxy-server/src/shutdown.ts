import type { CopilotService, Logger, Stats } from "copilot-sdk-proxy";
import { printUsageSummary } from "copilot-sdk-proxy";
import type { createServer } from "copilot-sdk-proxy";
import { restoreSettings } from "./settings-patcher/index.js";
import type { ProviderMode } from "copilot-sdk-proxy";

interface ShutdownContext {
  app: Awaited<ReturnType<typeof createServer>>;
  service: CopilotService;
  logger: Logger;
  stats: Stats;
  shouldPatch: boolean;
  proxyMode: ProviderMode;
  quiet: boolean;
  lastActivityRef: () => number;
  idleTimeoutMinutes: number;
}

const STOP_TIMEOUT_MS = 3000;

export function registerShutdownHandlers(ctx: ShutdownContext): void {
  const { app, service, logger, stats, shouldPatch, proxyMode, quiet, idleTimeoutMinutes } = ctx;

  const shutdown = async (signal: string) => {
    process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
      logger.debug(`Ignoring error during shutdown: ${err.message}`);
    });

    logger.info(`Got ${signal}, shutting down...`);

    if (shouldPatch) {
      await restoreSettings(proxyMode, logger);
    }

    await app.close();

    const stopPromise = service.stop().then(() => {
      logger.info("Clean shutdown complete");
    });
    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.warn("Copilot client didn't stop in time, forcing exit");
        resolve();
      }, STOP_TIMEOUT_MS),
    );

    await Promise.race([stopPromise, timeoutPromise]);

    if (!quiet) {
      printUsageSummary(stats.snapshot());
    }

    process.exit(0);
  };

  let shuttingDown = false;
  const onSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown(signal).catch((err: unknown) => {
      logger.error(`Shutdown error: ${String(err)}`);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => { onSignal("SIGINT"); });
  process.on("SIGTERM", () => { onSignal("SIGTERM"); });

  if (idleTimeoutMinutes > 0) {
    const idleMs = idleTimeoutMinutes * 60_000;
    const checkInterval = Math.min(idleMs, 60_000);
    const timer = setInterval(() => {
      if (Date.now() - ctx.lastActivityRef() >= idleMs) {
        clearInterval(timer);
        logger.info(`Idle for ${String(idleTimeoutMinutes)} minute(s), shutting down`);
        onSignal("idle-timeout");
      }
    }, checkInterval);
    timer.unref();
  }
}
