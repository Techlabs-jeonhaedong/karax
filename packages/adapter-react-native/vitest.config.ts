import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@karax/renderer": resolve(__dirname, "../renderer/dist/index.js"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
