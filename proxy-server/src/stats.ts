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
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StatsSnapshot {
  requests: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  apiDurationMs: number;
  errors: number;
  uptimeMs: number;
  modelMetrics: Record<string, ModelMetricsSnapshot>;
}

export class Stats {
  requests = 0;
  sessions = 0;
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  cacheWriteTokens = 0;
  totalCost = 0;
  apiDurationMs = 0;
  errors = 0;
  private startTime = Date.now();
  private byModel = new Map<string, ModelMetricsSnapshot>();

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
      modelMetrics: Object.fromEntries(this.byModel),
    };
  }
}
