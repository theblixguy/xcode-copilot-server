import type { FastifyReply } from "fastify";
import type { CopilotSession, Logger, Stats } from "copilot-sdk-proxy";
import { formatCompaction, recordUsageEvent } from "copilot-sdk-proxy";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import { isRecord } from "../../utils/type-guards.js";
import { BRIDGE_TOOL_PREFIX } from "../../bridge-constants.js";

// Xcode sends tool names without the bridge prefix.
function stripBridgePrefix(name: string): string {
  return name.startsWith(BRIDGE_TOOL_PREFIX) ? name.slice(BRIDGE_TOOL_PREFIX.length) : name;
}

export interface StrippedToolRequest {
  toolCallId: string;
  name: string;
  arguments?: unknown;
}

export interface BridgeStreamProtocol {
  flushDeltas(reply: FastifyReply, deltas: string[]): void;
  emitToolsAndFinish(reply: FastifyReply, tools: StrippedToolRequest[]): void;
  sendCompleted(reply: FastifyReply): void;
  sendFailed(reply: FastifyReply): void;
  teardown(): void;
  reset(): void;
}

interface SessionStreamingOptions {
  state: ToolBridgeState;
  session: CopilotSession;
  prompt: string;
  logger: Logger;
  hasBridge: boolean;
  protocol: BridgeStreamProtocol;
  initialReply: FastifyReply;
  stats: Stats;
}

export function runSessionStreaming(opts: SessionStreamingOptions): Promise<void> {
  return new StreamingHandler(opts).run();
}

class StreamingHandler {
  private pendingDeltas: string[] = [];
  private sessionDone = false;
  private readonly toolNames = new Map<string, string>();
  private unsubscribe = (): void => {};

  private readonly state: ToolBridgeState;
  private readonly session: CopilotSession;
  private readonly prompt: string;
  private readonly logger: Logger;
  private readonly hasBridge: boolean;
  private readonly protocol: BridgeStreamProtocol;
  private readonly initialReply: FastifyReply;
  private readonly stats: Stats;

  constructor(opts: SessionStreamingOptions) {
    this.state = opts.state;
    this.session = opts.session;
    this.prompt = opts.prompt;
    this.logger = opts.logger;
    this.hasBridge = opts.hasBridge;
    this.protocol = opts.protocol;
    this.initialReply = opts.initialReply;
    this.stats = opts.stats;
  }

  run(): Promise<void> {
    this.state.session.markSessionActive();
    this.unsubscribe = this.subscribeToEvents();
    this.setupClientDisconnect();

    const done = this.state.replies.waitForStreamingDone();
    this.sendPrompt();
    return done;
  }

  private getReply(): FastifyReply | null {
    return this.state.replies.currentReply;
  }

  private flushToProtocol(): void {
    if (this.pendingDeltas.length === 0) return;
    const r = this.getReply();
    if (!r) return;
    this.protocol.flushDeltas(r, this.pendingDeltas);
    this.pendingDeltas = [];
  }

  private finishStream(reply: FastifyReply | null): void {
    if (reply) {
      reply.raw.end();
      this.state.replies.clearReply();
    }
    this.state.replies.notifyStreamingDone();
  }

  private subscribeToEvents(): () => void {
    return this.session.on((event) => {
      switch (event.type) {
        case "tool.execution_start":
          this.onToolStart(event.data);
          break;
        case "tool.execution_complete":
          this.onToolComplete(event.data);
          break;
        case "assistant.message_delta":
          this.onDelta(event.data);
          break;
        case "assistant.message":
          this.onMessage(event.data);
          break;
        case "session.idle":
          this.onIdle();
          break;
        case "session.compaction_start":
          this.logger.info("Compacting context...");
          break;
        case "session.compaction_complete":
          this.logger.info(`Context compacted: ${formatCompaction(event.data)}`);
          break;
        case "session.error":
          this.onError(event.data.message);
          break;
        case "assistant.usage":
          recordUsageEvent(this.stats, this.logger, event.data);
          break;
        default:
          break;
      }
    });
  }

  private onToolStart(d: { toolCallId: string; toolName: string }): void {
    this.toolNames.set(d.toolCallId, d.toolName);
  }

  private onToolComplete(d: { toolCallId: string; success: boolean; error?: { message: string } }): void {
    const name = this.toolNames.get(d.toolCallId) ?? d.toolCallId;
    this.toolNames.delete(d.toolCallId);
    if (!d.success) {
      this.logger.debug(`${name} failed: ${d.error?.message ?? "unknown"}`);
    }
  }

  private onDelta(d: { deltaContent?: string }): void {
    if (d.deltaContent) this.pendingDeltas.push(d.deltaContent);
  }

  private stripAndNormalize(
    requests: { toolCallId: string; name: string; arguments?: unknown }[],
  ): StrippedToolRequest[] {
    const filtered = this.hasBridge
      ? requests.filter((tr) => tr.name.startsWith(BRIDGE_TOOL_PREFIX))
      : requests;

    return filtered.map((tr) => {
      const resolved = this.state.toolCache.resolveToolName(stripBridgePrefix(tr.name));
      const args: Record<string, unknown> = isRecord(tr.arguments) ? tr.arguments : {};
      return {
        toolCallId: tr.toolCallId,
        name: resolved,
        arguments: this.state.toolCache.normalizeArgs(resolved, args),
      };
    });
  }

  private onMessage(data: { toolRequests?: { toolCallId: string; name: string; arguments?: unknown }[] }): void {
    if (!data.toolRequests || data.toolRequests.length === 0) {
      const r = this.getReply();
      if (r) this.flushToProtocol();
      return;
    }

    const stripped = this.stripAndNormalize(data.toolRequests);
    if (stripped.length === 0) return;

    for (const tr of stripped) {
      this.logger.info(`Tool request: name="${tr.name}", id="${tr.toolCallId}"`);
      this.state.toolRouter.registerExpected(tr.toolCallId, tr.name);
    }

    const r = this.getReply();
    if (r) {
      this.flushToProtocol();
      this.protocol.emitToolsAndFinish(r, stripped);
      this.protocol.reset();
      this.finishStream(r);
    }
  }

  private onIdle(): void {
    this.logger.info("Done, wrapping up stream");
    this.sessionDone = true;
    this.state.session.markSessionInactive();
    this.flushToProtocol();
    const r = this.getReply();
    if (r) {
      this.protocol.sendCompleted(r);
      this.protocol.teardown();
    }
    this.finishStream(r);
    this.unsubscribe();
  }

  private onError(message: string): void {
    this.logger.error(`Session error: ${message}`);
    this.sessionDone = true;
    this.state.session.markSessionErrored();
    this.state.session.markSessionInactive();
    const r = this.getReply();
    if (r) {
      this.protocol.sendFailed(r);
    }
    this.protocol.teardown();
    this.finishStream(r);
    this.unsubscribe();
  }

  private setupClientDisconnect(): void {
    this.initialReply.raw.on("close", () => {
      if (!this.sessionDone && this.state.replies.currentReply === this.initialReply) {
        this.logger.info("Client disconnected, aborting session");
        this.protocol.teardown();
        this.protocol.reset();
        this.state.session.markSessionErrored();
        this.state.session.cleanup();
        this.unsubscribe();
        this.session.abort().catch((err: unknown) => {
          this.logger.error("Failed to abort session:", err);
        });
        this.finishStream(null);
      }
    });
  }

  private sendPrompt(): void {
    this.session.send({ prompt: this.prompt }).catch((err: unknown) => {
      if (this.sessionDone) return;
      this.logger.error("Failed to send prompt:", err);
      this.sessionDone = true;
      this.protocol.teardown();
      this.protocol.reset();
      this.unsubscribe();
      this.finishStream(this.getReply());
    });
  }
}
