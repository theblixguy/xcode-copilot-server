// Forces callers to handle every case of a union, so if a new variant is added,
// the unhandled value stops being `never` and this call fails to compile.
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err && typeof err.code === "string";
}
