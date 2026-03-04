import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerShutdownHandlers } from "../src/shutdown.js";

function createMockContext(overrides?: Partial<Parameters<typeof registerShutdownHandlers>[0]>) {
  return {
    app: { close: vi.fn().mockResolvedValue(undefined) },
    service: { stop: vi.fn().mockResolvedValue(undefined) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    stats: { snapshot: vi.fn().mockReturnValue({}) },
    shouldPatch: false,
    proxyMode: "claude" as const,
    quiet: true,
    lastActivityRef: () => Date.now(),
    idleTimeoutMinutes: 0,
    ...overrides,
  } as unknown as Parameters<typeof registerShutdownHandlers>[0];
}

type SignalHandler = (...args: unknown[]) => void;

describe("registerShutdownHandlers", () => {
  const listeners = new Map<string, SignalHandler[]>();

  beforeEach(() => {
    listeners.clear();
    vi.spyOn(process, "on").mockImplementation(((event: string, fn: SignalHandler) => {
      const fns = listeners.get(event) ?? [];
      fns.push(fn);
      listeners.set(event, fns);
      return process;
    }) as typeof process.on);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers SIGINT and SIGTERM handlers", () => {
    const ctx = createMockContext();
    registerShutdownHandlers(ctx);

    expect(listeners.has("SIGINT")).toBe(true);
    expect(listeners.has("SIGTERM")).toBe(true);
  });

  it("does not set idle timer when idleTimeoutMinutes is 0", () => {
    const spy = vi.spyOn(global, "setInterval");
    const ctx = createMockContext({ idleTimeoutMinutes: 0 });
    registerShutdownHandlers(ctx);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sets idle timer when idleTimeoutMinutes > 0", () => {
    const spy = vi.spyOn(global, "setInterval").mockReturnValue(
      { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>,
    );
    const ctx = createMockContext({ idleTimeoutMinutes: 5 });
    registerShutdownHandlers(ctx);

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    spy.mockRestore();
  });

  it("ignores duplicate signals", async () => {
    const ctx = createMockContext();
    registerShutdownHandlers(ctx);

    const sigintHandlers = listeners.get("SIGINT")!;
    // Fire twice, second should be ignored
    sigintHandlers[0]!();
    sigintHandlers[0]!();

    await new Promise((r) => setTimeout(r, 50));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.app.close).toHaveBeenCalledTimes(1);
  });
});
