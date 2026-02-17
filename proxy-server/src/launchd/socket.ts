import koffi from "koffi";

export type NativeActivateFn = (name: string) => number[];

function defaultNativeActivate(name: string): number[] {
  const lib = koffi.load("/usr/lib/libSystem.B.dylib");

  const launch_activate_socket = lib.func(
    "int launch_activate_socket(const char *name, _Out_ int **fds, _Out_ size_t *cnt)",
  );

  const fdsOut: [unknown] = [null];
  const cntOut = [0];

  const ret = launch_activate_socket(name, fdsOut, cntOut) as number;

  if (ret !== 0) {
    const messages: Record<number, string> = {
      3: "Socket name not found in launchd job (ESRCH)",
      2: "No socket with that name (ENOENT)",
    };
    const msg = messages[ret] ?? `errno ${String(ret)}`;
    throw new Error(`launch_activate_socket failed: ${msg}`);
  }

  const cnt = cntOut[0] as number;
  if (cnt === 0) {
    return [];
  }

  const ptr = fdsOut[0];
  const fds = koffi.decode(ptr, "int", cnt) as number[];

  // launch_activate_socket malloc's the fd array; caller must free it
  const free = lib.func("void free(void *ptr)");
  free(ptr);

  return fds;
}

export interface ActivateSocketOptions {
  nativeActivate?: NativeActivateFn;
}

export function activateSocket(
  name: string,
  options?: ActivateSocketOptions,
): number[] {
  const activate = options?.nativeActivate ?? defaultNativeActivate;
  return activate(name);
}
