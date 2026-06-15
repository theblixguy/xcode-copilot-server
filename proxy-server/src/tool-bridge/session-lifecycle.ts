import type { ToolRouter } from "./tool-router.js";
import { assertNever } from "../utils/type-guards.js";

// A session is idle, actively streaming, or finished with an error. Holding one
// value means "active" and "errored" can never be set at the same time.
export type SessionStatus = "idle" | "active" | "errored";

export class SessionLifecycle {
  private readonly toolRouter: ToolRouter;
  private _status: SessionStatus = "idle";

  constructor(toolRouter: ToolRouter) {
    this.toolRouter = toolRouter;
  }

  get status(): SessionStatus {
    return this._status;
  }

  get sessionActive(): boolean {
    switch (this._status) {
      case "active":
        return true;
      case "idle":
      case "errored":
        return false;
      default:
        return assertNever(this._status);
    }
  }

  get hadError(): boolean {
    switch (this._status) {
      case "errored":
        return true;
      case "idle":
      case "active":
        return false;
      default:
        return assertNever(this._status);
    }
  }

  markSessionActive(): void {
    // Clear leftover entries from abandoned tool cycles so they don't
    // sit at the front of the FIFO queue and bind to wrong call IDs.
    this.toolRouter.rejectAll("New session cycle");
    this._status = "active";
  }

  markSessionErrored(): void {
    this._status = "errored";
  }

  markSessionInactive(): void {
    // Don't reject expected entries here. The session goes idle before the
    // bridge's tools/call requests arrive, so they are still needed.
    this.deactivate();
  }

  cleanup(): void {
    this.toolRouter.rejectAll("Session cleanup");
    this.deactivate();
  }

  // Keep an errored status so callers can still see the failure after the
  // stream winds down. Only an active session falls back to idle.
  private deactivate(): void {
    switch (this._status) {
      case "active":
        this._status = "idle";
        return;
      case "idle":
      case "errored":
        return;
      default:
        assertNever(this._status);
    }
  }
}
