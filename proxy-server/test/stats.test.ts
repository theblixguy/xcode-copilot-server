import { describe, it, expect, vi, afterEach } from "vitest";
import { Stats } from "../src/stats.js";

describe("Stats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial snapshot returns all zeros", () => {
    const stats = new Stats();
    const snap = stats.snapshot();
    expect(snap.requests).toBe(0);
    expect(snap.sessions).toBe(0);
    expect(snap.inputTokens).toBe(0);
    expect(snap.outputTokens).toBe(0);
    expect(snap.cacheReadTokens).toBe(0);
    expect(snap.cacheWriteTokens).toBe(0);
    expect(snap.totalCost).toBe(0);
    expect(snap.apiDurationMs).toBe(0);
    expect(snap.errors).toBe(0);
    expect(Object.keys(snap.modelMetrics)).toHaveLength(0);
  });

  it("uptimeMs is positive after construction", () => {
    vi.useFakeTimers();
    const stats = new Stats();
    vi.advanceTimersByTime(500);
    expect(stats.snapshot().uptimeMs).toBeGreaterThanOrEqual(500);
    vi.useRealTimers();
  });

  describe("recordRequest", () => {
    it("increments request count", () => {
      const stats = new Stats();
      stats.recordRequest();
      stats.recordRequest();
      expect(stats.snapshot().requests).toBe(2);
    });
  });

  describe("recordSession", () => {
    it("increments session count", () => {
      const stats = new Stats();
      stats.recordSession();
      expect(stats.snapshot().sessions).toBe(1);
    });
  });

  describe("recordError", () => {
    it("increments error count", () => {
      const stats = new Stats();
      stats.recordError();
      stats.recordError();
      stats.recordError();
      expect(stats.snapshot().errors).toBe(3);
    });
  });

  describe("recordUsage", () => {
    it("accumulates token counts", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", inputTokens: 100, outputTokens: 50 });
      stats.recordUsage({ model: "gpt-4", inputTokens: 200, outputTokens: 75 });
      const snap = stats.snapshot();
      expect(snap.inputTokens).toBe(300);
      expect(snap.outputTokens).toBe(125);
    });

    it("accumulates cache tokens", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", cacheReadTokens: 500, cacheWriteTokens: 100 });
      stats.recordUsage({ model: "gpt-4", cacheReadTokens: 300, cacheWriteTokens: 200 });
      const snap = stats.snapshot();
      expect(snap.cacheReadTokens).toBe(800);
      expect(snap.cacheWriteTokens).toBe(300);
    });

    it("accumulates cost", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", cost: 0.05 });
      stats.recordUsage({ model: "gpt-4", cost: 0.10 });
      expect(stats.snapshot().totalCost).toBeCloseTo(0.15);
    });

    it("accumulates API duration", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", duration: 1000 });
      stats.recordUsage({ model: "gpt-4", duration: 2500 });
      expect(stats.snapshot().apiDurationMs).toBe(3500);
    });

    it("treats missing fields as zero", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4" });
      const snap = stats.snapshot();
      expect(snap.inputTokens).toBe(0);
      expect(snap.outputTokens).toBe(0);
      expect(snap.cacheReadTokens).toBe(0);
      expect(snap.cacheWriteTokens).toBe(0);
      expect(snap.totalCost).toBe(0);
      expect(snap.apiDurationMs).toBe(0);
    });
  });

  describe("per-model metrics", () => {
    it("tracks metrics separately per model", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", inputTokens: 100, outputTokens: 50, cost: 0.05 });
      stats.recordUsage({ model: "claude-3", inputTokens: 200, outputTokens: 75, cost: 0.10 });
      stats.recordUsage({ model: "gpt-4", inputTokens: 150, outputTokens: 25, cost: 0.03 });

      const snap = stats.snapshot();
      const models = snap.modelMetrics;
      expect(Object.keys(models)).toHaveLength(2);

      const gpt4 = models["gpt-4"];
      expect(gpt4).toBeDefined();
      expect(gpt4!.requests).toBe(2);
      expect(gpt4!.inputTokens).toBe(250);
      expect(gpt4!.outputTokens).toBe(75);
      expect(gpt4!.cost).toBeCloseTo(0.08);

      const claude = models["claude-3"];
      expect(claude).toBeDefined();
      expect(claude!.requests).toBe(1);
      expect(claude!.inputTokens).toBe(200);
      expect(claude!.outputTokens).toBe(75);
      expect(claude!.cost).toBeCloseTo(0.10);
    });

    it("tracks cache tokens per model", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", cacheReadTokens: 100, cacheWriteTokens: 50 });
      stats.recordUsage({ model: "gpt-4", cacheReadTokens: 200, cacheWriteTokens: 25 });

      const gpt4 = stats.snapshot().modelMetrics["gpt-4"];
      expect(gpt4).toBeDefined();
      expect(gpt4!.cacheReadTokens).toBe(300);
      expect(gpt4!.cacheWriteTokens).toBe(75);
    });
  });

  describe("snapshot immutability", () => {
    it("returns a deep copy of model metrics", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", inputTokens: 100, cost: 0.05 });

      const snap1 = stats.snapshot();
      const gpt4 = snap1.modelMetrics["gpt-4"];
      expect(gpt4).toBeDefined();

      (gpt4 as { inputTokens: number }).inputTokens = 9999;

      const snap2 = stats.snapshot();
      expect(snap2.modelMetrics["gpt-4"]!.inputTokens).toBe(100);
    });

    it("successive snapshots reflect new data", () => {
      const stats = new Stats();
      stats.recordUsage({ model: "gpt-4", inputTokens: 100 });
      const snap1 = stats.snapshot();

      stats.recordUsage({ model: "gpt-4", inputTokens: 200 });
      const snap2 = stats.snapshot();

      expect(snap1.inputTokens).toBe(100);
      expect(snap2.inputTokens).toBe(300);
    });
  });
});
