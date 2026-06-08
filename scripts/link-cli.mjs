#!/usr/bin/env node
/**
 * scripts/link-cli.mjs — karax CLI 글로벌 등록 스크립트
 *
 * node scripts/link-cli.mjs 또는 pnpm link-cli로 실행.
 * 전체 빌드 후 packages/cli를 pnpm link --global로 등록해
 * 터미널 어디서든 `karax` 명령어를 사용할 수 있게 한다.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ─── bootstrap.mjs 로드 ──────────────────────────────────────────────

const { isInstalled, isBuilt, isStale, planSteps, resolvePnpmCommand } = await import(
  new URL("./lib/bootstrap.mjs", import.meta.url).href
);

const { isCliBuilt, buildLinkArgs, resolveWhichCommand, buildMinimalEnv } = await import(
  new URL("./lib/link-cli.mjs", import.meta.url).href
);

// ─── 로그 헬퍼 ──────────────────────────────────────────────────────

/** @param {string} msg */
function info(msg) {
  process.stdout.write(`[link-cli] ${msg}\n`);
}

/** @param {string} msg */
function error(msg) {
  process.stderr.write(`[link-cli] 오류: ${msg}\n`);
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
 * @param {{ cwd?: string }} [opts]
 */
function runStep(cmd, args, opts = {}) {
  const isWin = process.platform === "win32";
  // cmd/args는 resolvePnpmCommand가 보장하는 신뢰 입력만 사용. shell:isWin은 Windows의 .cmd 실행을 위해 필요
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: "inherit",
    shell: isWin,
    env: buildMinimalEnv(process.env, process.platform),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} 실패 (exit code: ${result.status})`);
  }
}

async function main() {
  info("karax CLI 글로벌 등록을 시작합니다...");

  // ─── 1단계: 빌드 (필요 시) ───────────────────────────────────────
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
    runStep(pnpmCmd.cmd, [...pnpmCmd.args, "--filter", "@karax/core", "build"]);
    runStep(pnpmCmd.cmd, [...pnpmCmd.args, "-r", "build"]);
    info("     완료");
  } else {
    info("2/3  빌드 결과물 최신 상태 — 건너뜀");
  }

  // ─── 2단계: CLI dist 존재 검증 ───────────────────────────────────
  if (!isCliBuilt(ROOT)) {
    error("packages/cli/dist/bin.js가 존재하지 않습니다. 빌드가 실패했을 수 있습니다.");
    process.exit(1);
  }

  // ─── 3단계: pnpm link --global ───────────────────────────────────
  info("3/3  karax 명령어를 글로벌 PATH에 등록 중 (pnpm link --global)...");
  const cliPkgDir = join(ROOT, "packages/cli");
  const linkCmd = buildLinkArgs(pnpmCmd);
  runStep(linkCmd.cmd, linkCmd.args, { cwd: cliPkgDir });
  info("     완료");

  // ─── 등록 확인 ───────────────────────────────────────────────────
  const whichCmd = resolveWhichCommand(process.platform);
  const checkResult = spawnSync(whichCmd, ["karax"], { encoding: "utf8" });
  if (checkResult.status === 0) {
    const karaxPath = checkResult.stdout.trim();
    info(`\n완료! karax 명령어가 등록됐습니다.`);
    info(`  경로: ${karaxPath}`);
    info(`  이제 터미널 어디서든 'karax' 명령어를 사용할 수 있습니다.`);
  } else {
    // 링크 자체는 완료됐지만 현재 셸에서 PATH를 찾지 못한 경우 (PNPM_HOME 미설정 등)
    info(`\n[경고] 링크 자체는 완료됐지만 karax 명령을 PATH에서 찾지 못했습니다.`);
    info(`  pnpm 글로벌 bin 디렉토리가 PATH에 없을 수 있습니다.`);
    info(`  'pnpm setup' 실행 후 새 터미널을 열거나, 셸을 재시작해 보세요.`);
    info(`  (대안) 직접 실행: node packages/cli/dist/bin.js`);
  }
}

main().catch((err) => {
  error(String(err?.message ?? err));
  process.exit(1);
});
