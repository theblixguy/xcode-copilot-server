import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/live/**/*.test.ts"],
    setupFiles: ["src/fix-jsonrpc-import.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
