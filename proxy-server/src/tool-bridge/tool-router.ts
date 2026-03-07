interface PendingMCPRequest {
  toolCallId: string;
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

// streaming-core registers expected entries when the model emits tool requests.
// MCP route handlers promote them to pending when the SDK connects. Ordering is
// guaranteed: the client sees the tool_use block before it can POST to /mcp/:convId.
export class ToolRouter {
  private readonly timeoutMs: number;
  private readonly expectedByName = new Map<string, string[]>();
  // Reverse lookup: toolCallId to toolName for O(1) expected-entry removal
  private readonly expectedByCallId = new Map<string, string>();
  private readonly pendingByCallId = new Map<string, PendingMCPRequest>();

  constructor(timeoutMs = 0) {
    this.timeoutMs = timeoutMs;
  }

  hasPendingToolCall(toolCallId: string): boolean {
    return this.pendingByCallId.has(toolCallId) || this.expectedByCallId.has(toolCallId);
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
    this.expectedByCallId.set(toolCallId, toolName);
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
    if (!toolCallId) {
      reject(new Error(`Internal: expected toolCallId was falsy for "${name}"`));
      return;
    }
    this.expectedByCallId.delete(toolCallId);
    this.addPending(toolCallId, resolve, reject);
  }

  resolveToolCall(toolCallId: string, result: string): boolean {
    const pending = this.pendingByCallId.get(toolCallId);
    if (pending) {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout);
      this.pendingByCallId.delete(toolCallId);
      pending.resolve(result);
      return true;
    }

    // The CLI can resolve a tool without hitting the MCP endpoint (e.g. the tool
    // name wasn't in tools/list). Clean up the stale expected entry.
    const expectedName = this.expectedByCallId.get(toolCallId);
    if (expectedName !== undefined) {
      this.expectedByCallId.delete(toolCallId);
      const queue = this.expectedByName.get(expectedName);
      if (queue) {
        const idx = queue.indexOf(toolCallId);
        if (idx !== -1) queue.splice(idx, 1);
        if (queue.length === 0) this.expectedByName.delete(expectedName);
      }
      return true;
    }

    return false;
  }

  get hasPending(): boolean {
    return this.pendingByCallId.size > 0 || this.expectedByName.size > 0;
  }

  rejectAll(reason: string): void {
    this.expectedByName.clear();
    this.expectedByCallId.clear();
    for (const [, pending] of this.pendingByCallId) {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingByCallId.clear();
  }

  private addPending(
    toolCallId: string,
    resolve: (result: string) => void,
    reject: (err: Error) => void,
  ): void {
    const timeout = this.timeoutMs > 0
      ? setTimeout(() => {
          this.pendingByCallId.delete(toolCallId);
          reject(new Error(`Tool call ${toolCallId} timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs)
      : undefined;

    this.pendingByCallId.set(toolCallId, { toolCallId, resolve, reject, timeout });
  }
}
