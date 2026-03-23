import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
      exclude: ["**/dist/**"]
    }
  },
  {
    test: {
      name: "integration",
      include: ["apps/**/*.integration.test.ts", "packages/**/*.integration.test.ts"],
      exclude: ["**/dist/**"]
    }
  }
]);
