import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 600_000, // 통합 테스트(첫 빌드)는 최대 10분
    hookTimeout: 30_000,
    // wasm OOM 방지
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
