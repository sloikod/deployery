import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: [
      "apps/**/*.integration.test.ts",
      "packages/**/*.integration.test.ts",
    ],
    exclude: ["**/dist/**", "**/out/**", "**/node_modules/**"],
  },
});
