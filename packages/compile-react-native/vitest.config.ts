import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // 실 렌더링 테스트는 시간이 걸림 (병렬 환경에서 Chromium 콜드스타트 200s+ 가능)
    testTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@karax/adapter-api": path.resolve("../adapter-api/dist/index.js"),
      // playwright는 renderer 패키지 node_modules에 설치됨
      "playwright": path.resolve("../renderer/node_modules/playwright/index.js"),
    },
  },
});
