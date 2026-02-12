const TOOL_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingMCPRequest {
  toolCallId: string;
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ToolRouter {
  private readonly expectedByName = new Map<string, string[]>();
  private readonly pendingByCallId = new Map<string, PendingMCPRequest>();

  hasPendingToolCall(toolCallId: string): boolean {
    if (this.pendingByCallId.has(toolCallId)) return true;
    for (const [, queue] of this.expectedByName) {
      if (queue.includes(toolCallId)) return true;
    }
    return false;
  }

  hasExpectedTool(name: string): boolean {
    const queue = this.expectedByName.get(name);
    return !!queue && queue.length > 0;
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
      reject(new Error(`No expected tool call for "${name}"`));
      return;
    }
    const toolCallId = queue.shift();
    if (queue.length === 0) this.expectedByName.delete(name);
    if (!toolCallId) return;
    this.addPending(toolCallId, resolve, reject);
  }

  resolveToolCall(toolCallId: string, result: string): boolean {
    const pending = this.pendingByCallId.get(toolCallId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingByCallId.delete(toolCallId);
      pending.resolve(result);
      return true;
    }

    // The CLI may resolve a tool without going through the MCP endpoint (e.g. if
    // the tool name wasn't in our tools/list response and the CLI failed it
    // immediately). Clean up the stale expected entry so it doesn't poison
    // future registerMCPRequest calls for the same tool name.
    for (const [name, queue] of this.expectedByName) {
      const idx = queue.indexOf(toolCallId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        if (queue.length === 0) this.expectedByName.delete(name);
        return true;
      }
    }

    return false;
  }

  get hasPending(): boolean {
    return this.pendingByCallId.size > 0 || this.expectedByName.size > 0;
  }

  rejectAll(reason: string): void {
    this.expectedByName.clear();
    for (const [, pending] of this.pendingByCallId) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingByCallId.clear();
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
}
