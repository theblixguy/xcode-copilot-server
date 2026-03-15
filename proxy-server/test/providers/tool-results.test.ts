import { describe, it, expect, vi } from "vitest";
import { Logger } from "copilot-sdk-proxy";
import { ToolBridgeState } from "../../src/tool-bridge/state.js";
import { resolveToolResults } from "../../src/providers/claude/tool-results.js";
import { resolveResponsesToolResults } from "../../src/providers/codex/tool-results.js";

const logger = new Logger("none");

function setupPending(
  state: ToolBridgeState,
  callId: string,
  toolName: string,
): ReturnType<typeof vi.fn> {
  state.toolRouter.registerExpected(callId, toolName);
  const resolve = vi.fn();
  state.toolRouter.registerMCPRequest(toolName, resolve, vi.fn());
  return resolve;
}

describe("resolveToolResults (Claude)", () => {
  it("resolves tool_result blocks from the last user message", () => {
    const state = new ToolBridgeState();
    const resolve = setupPending(state, "tool-1", "Read");

    resolveToolResults(
      [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "result text",
            },
          ],
        },
      ],
      state,
      logger,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("result text");
  });

  it("handles array content in tool_result blocks", () => {
    const state = new ToolBridgeState();
    const resolve = setupPending(state, "tool-1", "Read");

    resolveToolResults(
      [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: [
                { type: "text", text: "line1" },
                { type: "text", text: "line2" },
              ],
            },
          ],
        },
      ],
      state,
      logger,
    );

    expect(resolve).toHaveBeenCalledWith("line1\nline2");
  });

  it("ignores non-user last message", () => {
    const state = new ToolBridgeState();
    const warnSpy = vi.spyOn(logger, "warn");
    resolveToolResults(
      [{ role: "assistant", content: "hello" }],
      state,
      logger,
    );
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("ignores string content in last message", () => {
    const state = new ToolBridgeState();
    const warnSpy = vi.spyOn(logger, "warn");
    resolveToolResults([{ role: "user", content: "just text" }], state, logger);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("handles empty messages array", () => {
    const state = new ToolBridgeState();
    const warnSpy = vi.spyOn(logger, "warn");
    resolveToolResults([], state, logger);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns when no pending request matches tool_use_id", () => {
    const state = new ToolBridgeState();
    const warnSpy = vi.spyOn(logger, "warn");

    resolveToolResults(
      [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "unknown-id",
              content: "result",
            },
          ],
        },
      ],
      state,
      logger,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown-id"));
    warnSpy.mockRestore();
  });
});

describe("resolveResponsesToolResults (Codex)", () => {
  it("resolves function call outputs", () => {
    const state = new ToolBridgeState();
    const resolve = setupPending(state, "call-1", "Read");

    resolveResponsesToolResults(
      [
        {
          type: "function_call_output",
          call_id: "call-1",
          output: "result text",
        },
      ],
      state,
      logger,
    );

    expect(resolve).toHaveBeenCalledWith("result text");
  });

  it("warns when no pending request matches call_id", () => {
    const state = new ToolBridgeState();
    const warnSpy = vi.spyOn(logger, "warn");

    resolveResponsesToolResults(
      [
        {
          type: "function_call_output",
          call_id: "unknown-id",
          output: "result",
        },
      ],
      state,
      logger,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown-id"));
    warnSpy.mockRestore();
  });

  it("resolves multiple outputs", () => {
    const state = new ToolBridgeState();
    const resolve1 = setupPending(state, "call-1", "Read");
    const resolve2 = setupPending(state, "call-2", "Write");

    resolveResponsesToolResults(
      [
        { type: "function_call_output", call_id: "call-1", output: "result 1" },
        { type: "function_call_output", call_id: "call-2", output: "result 2" },
      ],
      state,
      logger,
    );

    expect(resolve1).toHaveBeenCalledWith("result 1");
    expect(resolve2).toHaveBeenCalledWith("result 2");
  });
});
