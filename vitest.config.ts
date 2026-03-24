import { fileURLToPath } from "url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    passWithNoTests: true,
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/dist/**", "**/out/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.*", "**/dist/**", "**/out/**", "**/node_modules/**"],
    },
  },
});
