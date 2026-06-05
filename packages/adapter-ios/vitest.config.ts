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
    pool: "forks",
    poolOptions: {
      forks: {
        // tree-sitter swift wasm Turboshaft Zone OOM 방지
        // --wasm-num-compilation-tasks=1: 백그라운드 wasm 컴파일 워커 1개로 제한
        // --no-wasm-tier-up, --no-wasm-dynamic-tiering: Turboshaft JIT 비활성화
        singleFork: true,
        execArgv: [
          "--no-wasm-tier-up",
          "--no-wasm-dynamic-tiering",
          "--wasm-num-compilation-tasks=1",
        ],
      },
    },
  },
});
