import { describe, it, expect } from "vitest";
import { activateSocket } from "../../src/launchd/index.js";
import type { NativeActivateFn } from "../../src/launchd/index.js";

describe("activateSocket", () => {
  it("returns array of fds on success", () => {
    const mockActivate: NativeActivateFn = () => [3, 4];

    const fds = activateSocket("Listeners", { nativeActivate: mockActivate });
    expect(fds).toEqual([3, 4]);
  });

  it("returns single fd for typical single-socket config", () => {
    const mockActivate: NativeActivateFn = () => [3];

    const fds = activateSocket("Listeners", { nativeActivate: mockActivate });
    expect(fds).toEqual([3]);
  });

  it("passes the socket name to the native function", () => {
    let capturedName = "";
    const mockActivate: NativeActivateFn = (name: string) => {
      capturedName = name;
      return [5];
    };

    activateSocket("MySocket", { nativeActivate: mockActivate });
    expect(capturedName).toBe("MySocket");
  });

  it("throws descriptive error when not launched by launchd", () => {
    const mockActivate: NativeActivateFn = () => {
      throw new Error("launch_activate_socket failed: Socket name not found in launchd job (ESRCH)");
    };

    expect(() => activateSocket("Listeners", { nativeActivate: mockActivate }))
      .toThrow("Socket name not found in launchd job (ESRCH)");
  });

  it("throws descriptive error when socket name not found", () => {
    const mockActivate: NativeActivateFn = () => {
      throw new Error("launch_activate_socket failed: No socket with that name (ENOENT)");
    };

    expect(() => activateSocket("WrongName", { nativeActivate: mockActivate }))
      .toThrow("No socket with that name (ENOENT)");
  });

  it("returns empty array when native function returns empty", () => {
    const mockActivate: NativeActivateFn = () => [];

    const fds = activateSocket("Listeners", { nativeActivate: mockActivate });
    expect(fds).toEqual([]);
  });
});
