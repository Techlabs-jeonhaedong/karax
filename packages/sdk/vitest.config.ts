import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // Tier 1 통합 테스트(SFC_FLUTTER_INTEGRATION=1)는 flutter test 실행으로 오래 걸림
    testTimeout: 300_000,
    hookTimeout: 30_000,
    // tree-sitter WASM(swift/kotlin 등)의 V8 Turboshaft Zone OOM 방지:
    // --no-wasm-tier-up + --no-wasm-dynamic-tiering: Turboshaft JIT 비활성화
    // --wasm-num-compilation-tasks=1: 백그라운드 WASM 컴파일 스레드 1개로 제한
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
