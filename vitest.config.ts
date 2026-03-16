import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@db0-ai/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@db0-ai/backends-sqlite": path.resolve(
        __dirname,
        "packages/backends/sqlite/src/index.ts",
      ),
      "@db0-ai/backends-postgres": path.resolve(
        __dirname,
        "packages/backends/postgres/src/index.ts",
      ),
      "@db0-ai/openclaw": path.resolve(
        __dirname,
        "packages/apps/openclaw/src/index.ts",
      ),
    },
  },
  test: {
    globals: true,
    include: ["packages/**/__tests__/**/*.test.ts"],
  },
});
