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
      exclude: [
        "**/*.test.*",
        "**/*.d.ts",
        "**/dist/**",
        "**/out/**",
        "**/node_modules/**",
        "apps/api/src/index.ts",
        "packages/cli/src/main.ts",
        "packages/extension-desktop/src/app-manager.ts",
        "packages/extension-desktop/src/app-session.ts",
        "packages/extension-desktop/src/extension.ts",
        "packages/extension-desktop/src/window-panel.ts",
        "packages/persistence/src/schema.postgres.ts",
        "packages/persistence/src/schema.ts",
      ],
    },
  },
});
