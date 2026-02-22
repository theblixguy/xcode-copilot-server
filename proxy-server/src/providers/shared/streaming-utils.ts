import type { FastifyReply } from "fastify";
import type { Stats, UsageData } from "../../stats.js";
import type { Logger } from "../../logger.js";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const satisfies Record<string, string>;

export function sendSSEEvent(
  reply: FastifyReply,
  type: string,
  data: object,
  sequenceNumber?: number,
): void {
  if (sequenceNumber != null) {
    const payload = { ...(data as Record<string, unknown>), type, sequence_number: sequenceNumber };
    reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  } else {
    reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

export function sendSSEComment(reply: FastifyReply): void {
  reply.raw.write(": keepalive\n\n");
}

export function recordUsageEvent(stats: Stats, logger: Logger, data: UsageData): void {
  stats.recordUsage(data);
  logger.debug(`Usage: ${String(data.inputTokens ?? 0)} in, ${String(data.outputTokens ?? 0)} out, cost=${String(data.cost ?? 0)}`);
}

export function formatCompaction(data: unknown): string {
  if (
    !data ||
    typeof data !== "object" ||
    !("preCompactionTokens" in data) ||
    !("postCompactionTokens" in data)
  ) {
    return "compaction data unavailable";
  }
  return `${String(data.preCompactionTokens)} to ${String(data.postCompactionTokens)} tokens`;
}
