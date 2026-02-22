export interface UsageData {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  duration?: number;
}

export interface ModelMetricsSnapshot {
  readonly requests: number;
  readonly cost: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface StatsSnapshot {
  readonly requests: number;
  readonly sessions: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalCost: number;
  readonly apiDurationMs: number;
  readonly errors: number;
  readonly uptimeMs: number;
  readonly modelMetrics: Readonly<Record<string, ModelMetricsSnapshot>>;
}

interface MutableModelMetrics {
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export class Stats {
  // HTTP-level request count 
  private requests = 0;
  private sessions = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private totalCost = 0;
  private apiDurationMs = 0;
  private errors = 0;
  private startTime = Date.now();
  // Per-model LLM API call metrics
  private byModel = new Map<string, MutableModelMetrics>();

  recordUsage(data: UsageData): void {
    const input = data.inputTokens ?? 0;
    const output = data.outputTokens ?? 0;
    const cacheRead = data.cacheReadTokens ?? 0;
    const cacheWrite = data.cacheWriteTokens ?? 0;
    const cost = data.cost ?? 0;
    const duration = data.duration ?? 0;

    this.inputTokens += input;
    this.outputTokens += output;
    this.cacheReadTokens += cacheRead;
    this.cacheWriteTokens += cacheWrite;
    this.totalCost += cost;
    this.apiDurationMs += duration;

    const { model } = data;
    const existing = this.byModel.get(model);
    if (existing) {
      existing.requests++;
      existing.cost += cost;
      existing.inputTokens += input;
      existing.outputTokens += output;
      existing.cacheReadTokens += cacheRead;
      existing.cacheWriteTokens += cacheWrite;
    } else {
      this.byModel.set(model, {
        requests: 1, cost, inputTokens: input, outputTokens: output,
        cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
      });
    }
  }

  recordRequest(): void {
    this.requests++;
  }

  recordSession(): void {
    this.sessions++;
  }

  recordError(): void {
    this.errors++;
  }

  snapshot(): StatsSnapshot {
    return {
      requests: this.requests,
      sessions: this.sessions,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      totalCost: this.totalCost,
      apiDurationMs: this.apiDurationMs,
      errors: this.errors,
      uptimeMs: Date.now() - this.startTime,
      modelMetrics: Object.fromEntries(
        Array.from(this.byModel.entries(), ([k, v]) => [k, { ...v }]),
      ),
    };
  }
}
