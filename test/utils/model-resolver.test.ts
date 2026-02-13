import { describe, it, expect } from "vitest";
import type { ModelInfo } from "@github/copilot-sdk";
import { resolveModel } from "../../src/providers/shared/model-resolver.js";

function model(id: string): ModelInfo {
  return {
    id,
    name: id,
    capabilities: {
      supports: { vision: false, reasoningEffort: false },
      limits: { max_context_window_tokens: 200000 },
    },
  };
}

const copilotModels = [
  "claude-haiku-4.5",
  "claude-opus-4.5",
  "claude-sonnet-4",
  "claude-sonnet-4.5",
  "gpt-5",
  "gpt-5.1",
].map(model);

describe("resolveModel", () => {
  it("exact match returns as-is", () => {
    expect(resolveModel("claude-sonnet-4.5", copilotModels)).toBe(
      "claude-sonnet-4.5",
    );
  });

  it("strips date suffix and normalizes dots", () => {
    expect(resolveModel("claude-sonnet-4-5-20250929", copilotModels)).toBe(
      "claude-sonnet-4.5",
    );
  });

  it("strips date suffix for model without minor version", () => {
    expect(resolveModel("claude-sonnet-4-20250514", copilotModels)).toBe(
      "claude-sonnet-4",
    );
  });

  it("normalizes hyphens to dots without date", () => {
    expect(resolveModel("claude-haiku-4-5", copilotModels)).toBe(
      "claude-haiku-4.5",
    );
  });

  it("falls back to same family when version not available", () => {
    // Opus 4.6 doesn't exist in Copilot, should fall back to 4.5
    expect(resolveModel("claude-opus-4-6", copilotModels)).toBe(
      "claude-opus-4.5",
    );
  });

  it("falls back to closest in family when multiple candidates", () => {
    // claude-sonnet-4-7 doesn't exist and the family has 4 and 4.5, so
    // "claude-sonnet-4-5" wins because it shares a longer prefix than "claude-sonnet-4"
    expect(resolveModel("claude-sonnet-4-7", copilotModels)).toBe(
      "claude-sonnet-4.5",
    );
  });

  it("returns undefined for completely unknown model", () => {
    expect(resolveModel("unknown-model-123", copilotModels)).toBeUndefined();
  });

  it("returns undefined for different family with no match", () => {
    expect(resolveModel("claude-mega-5-0", copilotModels)).toBeUndefined();
  });

  it("handles non-claude models (exact match)", () => {
    expect(resolveModel("gpt-5", copilotModels)).toBe("gpt-5");
  });

  it("handles date suffix on haiku model", () => {
    expect(resolveModel("claude-haiku-4-5-20251001", copilotModels)).toBe(
      "claude-haiku-4.5",
    );
  });

  it("returns undefined for empty models array", () => {
    expect(resolveModel("claude-sonnet-4.5", [])).toBeUndefined();
  });
});
