#!/usr/bin/env node
/**
 * scripts/setup.mjs — 사전 워밍업 스크립트 (선택적 수동 실행)
 *
 * pnpm bootstrap 또는 node scripts/setup.mjs로 실행.
 * install + build + Chromium 설치까지 미리 수행해 첫 MCP 실행 지연을 없앤다.
 * MCP 프로토콜 채널이 아니므로 stdout 출력 자유.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ─── bootstrap.mjs 로드 ──────────────────────────────────────────────

const { isInstalled, isBuilt, isStale, planSteps, resolvePnpmCommand } = await import(
  new URL("./lib/bootstrap.mjs", import.meta.url).href
);

// ─── 로그 헬퍼 ──────────────────────────────────────────────────────

/** @param {string} msg */
function info(msg) {
  process.stdout.write(`[setup] ${msg}\n`);
}

/** @param {string} msg */
function error(msg) {
  process.stderr.write(`[setup] 오류: ${msg}\n`);
}

// ─── pnpm 명령 해석 ──────────────────────────────────────────────────

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function hasCommand(cmd) {
  const result = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [cmd],
    { stdio: "ignore" }
  );
  return result.status === 0;
}

const hasCorepack = hasCommand("corepack");
const hasPnpmOnPath = hasCommand("pnpm");
const pnpmCmd = resolvePnpmCommand({ hasPnpmOnPath, hasCorepack });

if (!pnpmCmd) {
  error("corepack 또는 pnpm을 찾을 수 없습니다. https://pnpm.io/installation 참고");
  process.exit(1);
}

// ─── 단계별 실행 ─────────────────────────────────────────────────────

/**
 * @param {string} cmd
 * @param {string[]} args
 */
function runStep(cmd, args) {
  const isWin = process.platform === "win32";
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: isWin,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} 실패 (exit code: ${result.status})`);
  }
}

async function main() {
  info("karax MCP 서버 사전 워밍업을 시작합니다...");

  const installed = isInstalled(ROOT);
  const built = isBuilt(ROOT);
  const stale = isStale(ROOT);
  const steps = planSteps({ installed, built, stale });

  if (steps.includes("install")) {
    info("1/3  의존성 설치 중 (pnpm install)...");
    runStep(pnpmCmd.cmd, [...pnpmCmd.args, "install"]);
    info("     완료");
  } else {
    info("1/3  의존성 이미 설치됨 — 건너뜀");
  }

  if (steps.includes("build")) {
    info("2/3  전체 빌드 중 (pnpm -r build)...");
    // core를 먼저 단독 빌드해 의존 패키지들의 타입 선언을 확보
    runStep(pnpmCmd.cmd, [...pnpmCmd.args, "--filter", "@karax/core", "build"]);
    runStep(pnpmCmd.cmd, [...pnpmCmd.args, "-r", "build"]);
    info("     완료");
  } else {
    info("2/3  빌드 결과물 최신 상태 — 건너뜀");
  }

  // Chromium 설치: ensureDependencies를 MCP bin 없이도 호출할 수 있게
  // doctor 패키지의 ensureChromium을 직접 import (빌드 후 dist 경로)
  info("3/3  Playwright Chromium 설치 확인 중...");
  try {
    const doctorDist = join(ROOT, "packages/doctor/dist/ensure.js");
    const { ensureChromium } = await import(doctorDist);
    const result = await ensureChromium();
    if (result.alreadyPresent) {
      info("     Chromium 이미 설치됨 — 건너뜀");
    } else {
      info("     Chromium 설치 완료");
    }
  } catch (err) {
    // Chromium 설치는 선택적 — 실패해도 진행
    error(`Chromium 설치 실패 (무시): ${err?.message ?? String(err)}`);
    error("     나중에 수동으로 설치하거나, MCP 서버 첫 실행 시 자동 설치됩니다.");
  }

  info("\n완료! 이제 MCP 서버를 사용할 준비가 됐습니다.");
  info("Claude Code에서 프로젝트를 열면 .mcp.json이 자동으로 인식됩니다.");
}

main().catch((err) => {
  error(String(err?.message ?? err));
  process.exit(1);
});
