import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/fix-jsonrpc-import.ts"],
  },
});
