#!/usr/bin/env node
/**
 * @karax/mcp 실행 파일
 * npx @karax/mcp 로 실행 가능
 */

// ─── WASM Turboshaft 워크어라운드 self-respawn ────────────────────────
// Node v24 V8 Turboshaft가 tree-sitter-swift.wasm을 백그라운드 컴파일할 때
// Zone OOM으로 프로세스가 즉사한다 (iOS 어댑터 사용 시 100% 재현).
// packages/adapter-ios/vitest.config.ts에 동일한 워크어라운드 적용돼 있음.
// V8 플래그는 NODE_OPTIONS 허용 목록에 없어 환경 변수 전달 불가 → execArgv로만 가능.
{
  const WASM_FLAGS = [
    "--no-wasm-tier-up",
    "--no-wasm-dynamic-tiering",
    "--wasm-num-compilation-tasks=1",
  ];
  const WASM_MARKER_ENV = "KARAX_WASM_FLAGS_APPLIED";

  const needsRespawn =
    process.env[WASM_MARKER_ENV] !== "1" &&
    !process.execArgv.includes("--no-wasm-tier-up");

  if (needsRespawn) {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      [...WASM_FLAGS, process.argv[1], ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, [WASM_MARKER_ENV]: "1" },
      }
    );
    process.exit(result.status ?? 1);
  }
}
// ─────────────────────────────────────────────────────────────────────

import { startStdioServer } from "./server.js";

startStdioServer().catch((err) => {
  console.error("[karax/mcp] 서버 시작 실패:", err);
  process.exit(1);
});
