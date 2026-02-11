import type { FastifyReply } from "fastify";
import type { AnthropicToolDefinition } from "../schemas/anthropic.js";
import { ToolCache } from "./tool-cache.js";
import { ToolRouter } from "./tool-router.js";
import { ReplyTracker } from "./reply-tracker.js";
import { SessionLifecycle } from "./session-lifecycle.js";

export class ToolBridgeState {
  readonly toolCache = new ToolCache();
  readonly toolRouter = new ToolRouter();
  readonly replyTracker = new ReplyTracker();
  readonly session = new SessionLifecycle(this.toolRouter);

  // -- ToolCache delegation --

  cacheTools(tools: AnthropicToolDefinition[]): void {
    this.toolCache.cacheTools(tools);
  }

  getCachedTools(): AnthropicToolDefinition[] {
    return this.toolCache.getCachedTools();
  }

  resolveToolName(name: string): string {
    return this.toolCache.resolveToolName(name);
  }

  // -- ToolRouter delegation --

  hasPendingToolCall(toolCallId: string): boolean {
    return this.toolRouter.hasPendingToolCall(toolCallId);
  }

  hasExpectedTool(name: string): boolean {
    return this.toolRouter.hasExpectedTool(name);
  }

  registerExpected(toolCallId: string, toolName: string): void {
    this.toolRouter.registerExpected(toolCallId, toolName);
  }

  registerMCPRequest(
    name: string,
    resolve: (result: string) => void,
    reject: (err: Error) => void,
  ): void {
    this.toolRouter.registerMCPRequest(name, resolve, reject);
  }

  resolveToolCall(toolCallId: string, result: string): boolean {
    return this.toolRouter.resolveToolCall(toolCallId, result);
  }

  get hasPending(): boolean {
    return this.toolRouter.hasPending;
  }

  // -- ReplyTracker delegation --

  get currentReply(): FastifyReply | null {
    return this.replyTracker.currentReply;
  }

  setReply(reply: FastifyReply): void {
    this.replyTracker.setReply(reply);
  }

  clearReply(): void {
    this.replyTracker.clearReply();
  }

  notifyStreamingDone(): void {
    this.replyTracker.notifyStreamingDone();
  }

  waitForStreamingDone(): Promise<void> {
    return this.replyTracker.waitForStreamingDone();
  }

  // -- SessionLifecycle delegation --

  get sessionActive(): boolean {
    return this.session.sessionActive;
  }

  get hadError(): boolean {
    return this.session.hadError;
  }

  markSessionActive(): void {
    this.session.markSessionActive();
  }

  markSessionErrored(): void {
    this.session.markSessionErrored();
  }

  markSessionInactive(): void {
    this.session.markSessionInactive();
  }

  onSessionEnd(callback: () => void): void {
    this.session.onSessionEnd(callback);
  }

  cleanup(): void {
    this.session.cleanup();
  }
}
