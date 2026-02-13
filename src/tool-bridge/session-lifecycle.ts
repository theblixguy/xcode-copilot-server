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

    // Stale entries from tool calls that never went through the bridge
    // (denied or handled internally) would hang the next continuation
    this.toolRouter.rejectAll("Session ended");

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
