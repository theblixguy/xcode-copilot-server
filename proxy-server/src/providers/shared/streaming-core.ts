import type { FastifyReply } from "fastify";
import type {
  CopilotSession,
  Logger,
  Stats,
  CommonEventHandler,
} from "copilot-sdk-proxy";
import { createCommonEventHandler } from "copilot-sdk-proxy";
import type { ToolBridgeState } from "../../tool-bridge/state.js";
import { isRecord } from "../../utils/type-guards.js";
import { BRIDGE_TOOL_PREFIX } from "../../tool-bridge/bridge-constants.js";

// Xcode sends tool names without the bridge prefix.
function stripBridgePrefix(name: string): string {
  return name.startsWith(BRIDGE_TOOL_PREFIX)
    ? name.slice(BRIDGE_TOOL_PREFIX.length)
    : name;
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

export function runSessionStreaming(
  opts: SessionStreamingOptions,
): Promise<void> {
  return new StreamingHandler(opts).run();
}

class StreamingHandler {
  private sessionDone = false;
  private unsubscribe = (): void => {};
  private readonly common: CommonEventHandler;

  private readonly state: ToolBridgeState;
  private readonly session: CopilotSession;
  private readonly prompt: string;
  private readonly logger: Logger;
  private readonly hasBridge: boolean;
  private readonly protocol: BridgeStreamProtocol;
  private readonly initialReply: FastifyReply;

  constructor(opts: SessionStreamingOptions) {
    this.state = opts.state;
    this.session = opts.session;
    this.prompt = opts.prompt;
    this.logger = opts.logger;
    this.hasBridge = opts.hasBridge;
    this.protocol = opts.protocol;
    this.initialReply = opts.initialReply;
    this.common = createCommonEventHandler(
      opts.protocol,
      () => this.state.replies.currentReply,
      opts.logger,
      opts.stats,
    );
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

  private finishStream(reply: FastifyReply | null): void {
    if (reply) {
      reply.raw.end();
      this.state.replies.clearReply();
    }
    this.state.replies.notifyStreamingDone();
  }

  // Common events (reasoning, usage, compaction, message deltas, tool execution
  // logging) are handled by the SDK proxy's CommonEventHandler. This handler
  // only deals with events that need bridge-specific behavior.
  private subscribeToEvents(): () => void {
    return this.session.on((event) => {
      if (this.common.handle(event)) return;

      switch (event.type) {
        case "assistant.message":
          this.onMessage(event.data);
          break;
        case "session.idle":
          this.onIdle();
          break;
        case "session.error":
          this.onError(event.data.message);
          break;
        default:
          break;
      }
    });
  }

  private stripAndNormalize(
    requests: { toolCallId: string; name: string; arguments?: unknown }[],
  ): StrippedToolRequest[] {
    const filtered = this.hasBridge
      ? requests.filter((tr) => tr.name.startsWith(BRIDGE_TOOL_PREFIX))
      : requests;

    return filtered.map((tr) => {
      const resolved = this.state.toolCache.resolveToolName(
        stripBridgePrefix(tr.name),
      );
      const args: Record<string, unknown> = isRecord(tr.arguments)
        ? tr.arguments
        : {};
      return {
        toolCallId: tr.toolCallId,
        name: resolved,
        arguments: this.state.toolCache.normalizeArgs(resolved, args),
      };
    });
  }

  private onMessage(data: {
    toolRequests?: { toolCallId: string; name: string; arguments?: unknown }[];
  }): void {
    if (!data.toolRequests || data.toolRequests.length === 0) {
      const r = this.getReply();
      if (r) this.common.flushDeltas();
      return;
    }

    const stripped = this.stripAndNormalize(data.toolRequests);
    if (stripped.length === 0) return;

    for (const tr of stripped) {
      this.logger.info(
        `Tool request: name="${tr.name}", id="${tr.toolCallId}"`,
      );
      this.state.toolRouter.registerExpected(tr.toolCallId, tr.name);
    }

    const r = this.getReply();
    if (r) {
      this.common.flushDeltas();
      this.protocol.emitToolsAndFinish(r, stripped);
      this.protocol.reset();
      this.finishStream(r);
    }
  }

  private onIdle(): void {
    this.logger.info("Done, wrapping up stream");
    this.sessionDone = true;
    this.state.session.markSessionInactive();
    this.common.flushDeltas();
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
      if (
        !this.sessionDone &&
        this.state.replies.currentReply === this.initialReply
      ) {
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
      this.state.session.markSessionErrored();
      this.state.session.markSessionInactive();
      const r = this.getReply();
      if (r) {
        this.protocol.sendFailed(r);
      }
      this.protocol.teardown();
      this.protocol.reset();
      this.finishStream(r);
      this.unsubscribe();
    });
  }
}
