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
    const { formatRespawnCrash } = await import("@karax/core");

    const result = spawnSync(
      process.execPath,
      [...WASM_FLAGS, process.argv[1], ...process.argv.slice(2)],
      {
        stdio: "inherit",
        // env는 ...process.env 그대로 → KARAX_DEBUG 자동 전파
        env: { ...process.env, [WASM_MARKER_ENV]: "1" },
      }
    );

    // respawn 크래시 감지 + stderr 보고
    const crashMsg = formatRespawnCrash(result);
    if (crashMsg !== null) {
      process.stderr.write(`[karax/mcp] WASM respawn 크래시: ${crashMsg}\n`);
    }

    process.exit(result.status ?? 1);
  }
}
// ─────────────────────────────────────────────────────────────────────

// ─── 전역 unhandled 핸들러 (mcp bin.ts 진입점 한정) ──────────────────
// MCP 서버는 JSON-RPC 채널(stdout)을 보호해야 하므로 stderr 전용으로만 출력.
// KARAX_DEBUG=1일 때 full stack 추가.

const _mcpDebug = process.env["KARAX_DEBUG"] === "1";

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`[karax/mcp] unhandledRejection: ${message}\n`);
  if (_mcpDebug && reason instanceof Error && reason.stack) {
    process.stderr.write(`${reason.stack}\n`);
  }
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`[karax/mcp] uncaughtException: ${err.message}\n`);
  if (_mcpDebug && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────

import { startStdioServer } from "./server.js";

startStdioServer().catch((err) => {
  console.error("[karax/mcp] 서버 시작 실패:", err);
  process.exit(1);
});
