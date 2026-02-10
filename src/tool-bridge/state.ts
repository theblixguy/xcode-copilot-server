import type { FastifyReply } from "fastify";
import type { AnthropicToolDefinition } from "../schemas/anthropic.js";

const TOOL_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingMCPRequest {
  toolCallId: string;
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ToolBridgeState {
  private cachedTools: AnthropicToolDefinition[] = [];

  // Queues tool call IDs by name so we can match them to incoming MCP HTTP
  // requests in the order the model issued them.
  private readonly expectedByName = new Map<string, string[]>();

  // Once matched, holds the pending MCP request until Xcode sends the tool_result.
  private readonly pendingByCallId = new Map<string, PendingMCPRequest>();

  private reply: FastifyReply | null = null;
  private streamingDone: (() => void) | null = null;

  private _sessionActive = false;

  get currentReply(): FastifyReply | null {
    return this.reply;
  }

  setReply(reply: FastifyReply): void {
    this.reply = reply;
  }

  clearReply(): void {
    this.reply = null;
  }

  cacheTools(tools: AnthropicToolDefinition[]): void {
    this.cachedTools = tools;
  }

  getCachedTools(): AnthropicToolDefinition[] {
    return this.cachedTools;
  }

  registerExpected(toolCallId: string, toolName: string): void {
    const queue = this.expectedByName.get(toolName);
    if (queue) {
      queue.push(toolCallId);
    } else {
      this.expectedByName.set(toolName, [toolCallId]);
    }
  }

  registerMCPRequest(
    name: string,
    resolve: (result: string) => void,
    reject: (err: Error) => void,
  ): void {
    const queue = this.expectedByName.get(name);
    if (!queue?.length) {
      // The CLI always fires assistant.message before tool execution starts
      // (it serializes tool calls), so an MCP request arriving without a
      // matching expected entry means something went wrong.
      reject(new Error(`No expected tool call for "${name}"`));
      return;
    }
    const toolCallId = queue.shift();
    if (queue.length === 0) this.expectedByName.delete(name);
    if (!toolCallId) return;
    this.addPending(toolCallId, resolve, reject);
  }

  private addPending(
    toolCallId: string,
    resolve: (result: string) => void,
    reject: (err: Error) => void,
  ): void {
    const timeout = setTimeout(() => {
      this.pendingByCallId.delete(toolCallId);
      reject(new Error(`Tool call ${toolCallId} timed out`));
    }, TOOL_TIMEOUT_MS);

    this.pendingByCallId.set(toolCallId, { toolCallId, resolve, reject, timeout });
  }

  resolveToolCall(toolCallId: string, result: string): boolean {
    const pending = this.pendingByCallId.get(toolCallId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingByCallId.delete(toolCallId);
    pending.resolve(result);
    return true;
  }

  get hasPending(): boolean {
    return this.pendingByCallId.size > 0 || this.expectedByName.size > 0;
  }

  get sessionActive(): boolean {
    return this._sessionActive;
  }

  markSessionActive(): void {
    this._sessionActive = true;
  }

  markSessionInactive(): void {
    this._sessionActive = false;

    // Some tool calls never go through the MCP bridge (e.g. denied by the
    // permission hook or handled internally by the CLI). Their stale entries
    // would cause the next request to be treated as a continuation, hanging
    // forever since no one resolves them.
    this.expectedByName.clear();
    for (const [, pending] of this.pendingByCallId) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Session ended"));
    }
    this.pendingByCallId.clear();
  }

  notifyStreamingDone(): void {
    if (this.streamingDone) {
      this.streamingDone();
      this.streamingDone = null;
    }
  }

  waitForStreamingDone(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.streamingDone = resolve;
    });
  }

  cleanup(): void {
    this._sessionActive = false;

    for (const [, pending] of this.pendingByCallId) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Session cleanup"));
    }
    this.pendingByCallId.clear();
    this.expectedByName.clear();
  }
}
