import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger } from "../src/logger.js";

describe("Logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to info level", () => {
    const logger = new Logger();
    expect(logger.level).toBe("info");
  });

  it("none level suppresses all output", () => {
    const logger = new Logger("none");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test");
    expect(spy).not.toHaveBeenCalled();
  });

  it("error level only logs errors", () => {
    const logger = new Logger("error");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.debug("debug");

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("info level logs error, warn, and info but not debug", () => {
    const logger = new Logger("info");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.debug("debug");

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("debug level logs everything", () => {
    const logger = new Logger("debug");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.error("err");
    logger.warn("warn");
    logger.info("info");
    logger.debug("debug");

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it("formats messages with level prefix", () => {
    const logger = new Logger("debug");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.error("something broke");
    logger.info("all good");

    expect(errorSpy).toHaveBeenCalledWith("[ERROR] something broke");
    expect(logSpy).toHaveBeenCalledWith("[INFO] all good");
  });
});
