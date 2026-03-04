import type { ToolRouter } from "./tool-router.js";

export class SessionLifecycle {
  private readonly toolRouter: ToolRouter;
  private _sessionActive = false;
  private _hadError = false;
  private _onSessionEnd: (() => void) | null = null;

  constructor(toolRouter: ToolRouter) {
    this.toolRouter = toolRouter;
  }

  get sessionActive(): boolean {
    return this._sessionActive;
  }

  get hadError(): boolean {
    return this._hadError;
  }

  markSessionActive(): void {
    // Clear leftover entries from abandoned tool cycles so they don't
    // sit at the front of the FIFO queue and bind to wrong call IDs.
    this.toolRouter.rejectAll("New session cycle");
    this._sessionActive = true;
  }

  markSessionErrored(): void {
    this._hadError = true;
  }

  onSessionEnd(callback: () => void): void {
    this._onSessionEnd = callback;
  }

  markSessionInactive(): void {
    this._sessionActive = false;
    // Don't reject expected entries here. handler-core's finally block
    // calls this before the MCP tools/call request arrives, so rejecting
    // would wipe entries the bridge still needs. cleanup() handles that.
    this.fireSessionEnd();
  }

  cleanup(): void {
    this._sessionActive = false;
    this.toolRouter.rejectAll("Session cleanup");
    this.fireSessionEnd();
  }

  private fireSessionEnd(): void {
    if (this._onSessionEnd) {
      this._onSessionEnd();
      this._onSessionEnd = null;
    }
  }
}
