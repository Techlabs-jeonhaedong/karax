import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // 통합 테스트(SFC_FLUTTER_INTEGRATION=1)는 flutter test 실행으로 오래 걸림
    testTimeout: 300_000,
    hookTimeout: 30_000,
  },
});
