import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // CLI e2e 테스트는 child_process를 통해 CLI를 실행하므로 타임아웃을 늘림
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // tree-sitter WASM V8 Zone OOM 방지 (iOS swift WASM)
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: [
          "--no-wasm-tier-up",
          "--no-wasm-dynamic-tiering",
          "--wasm-num-compilation-tasks=1",
        ],
      },
    },
  },
});
