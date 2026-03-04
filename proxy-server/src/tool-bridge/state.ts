import { ToolCache } from "./tool-cache.js";
import { ToolRouter } from "./tool-router.js";
import { ReplyTracker } from "./reply-tracker.js";
import { SessionLifecycle } from "./session-lifecycle.js";

export class ToolBridgeState {
  readonly toolCache = new ToolCache();
  readonly toolRouter = new ToolRouter();
  readonly replies = new ReplyTracker();
  readonly session = new SessionLifecycle(this.toolRouter);
  private _filteredTools: unknown[] | undefined;

  get filteredTools(): unknown[] | undefined {
    return this._filteredTools;
  }

  setFilteredTools(tools: unknown[]): void {
    this._filteredTools = tools;
  }
}
