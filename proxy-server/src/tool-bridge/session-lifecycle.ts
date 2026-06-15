import type { ToolRouter } from "./tool-router.js";

export class SessionLifecycle {
  private readonly toolRouter: ToolRouter;
  private _sessionActive = false;
  private _hadError = false;

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

  markSessionInactive(): void {
    // Don't reject expected entries here. The session goes idle before the
    // bridge's tools/call requests arrive, so they are still needed.
    this._sessionActive = false;
  }

  cleanup(): void {
    this._sessionActive = false;
    this.toolRouter.rejectAll("Session cleanup");
  }
}
