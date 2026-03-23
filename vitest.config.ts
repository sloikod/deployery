import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        passWithNoTests: true,
        include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
        exclude: ["**/dist/**", "**/out/**", "**/node_modules/**"],
    },
});
