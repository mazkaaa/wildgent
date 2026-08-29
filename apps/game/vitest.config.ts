import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["src/tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
