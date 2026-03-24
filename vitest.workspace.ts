import { defineProject } from "vitest/config";

export default [
  defineProject({
    test: {
      name: "unit",
      include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
      exclude: ["**/dist/**"],
    },
  }),
  defineProject({
    test: {
      name: "integration",
      include: [
        "apps/**/*.integration.test.ts",
        "packages/**/*.integration.test.ts",
      ],
      exclude: ["**/dist/**"],
    },
  }),
];
