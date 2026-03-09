import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "tsconfig.check.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/only-throw-error": ["error", { allow: [{ from: "lib", name: "never" }] }],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["bin/", "dist/", "node_modules/", "scripts/", "config.json5", "eslint.config.js", "vitest.config.ts", "vitest.live.config.ts"],
  },
);
