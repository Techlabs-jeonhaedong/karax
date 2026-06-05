#!/usr/bin/env node
/**
 * scripts/mcp-launcher.mjs — 자가 부트스트랩 MCP 서버 런처
 *
 * 외부 의존성 0 (순수 Node.js). .mcp.json에서 직접 실행한다.
 * - ROOT는 import.meta.url 기준 자가 계산 (cwd 비의존)
 * - 모든 로그는 stderr 전용. stdout은 MCP 프로토콜 채널이므로 절대 사용 금지
 * - 동시 첫 실행 가드: 루트 .mcp-bootstrap.lock 파일로 원자 락
 * - 준비 완료 후 packages/mcp/dist/bin.js로 stdio 상속 핸드오프
 */

import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeSync, unlinkSync, openSync, closeSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── 경로 계산 ───────────────────────────────────────────────────────

// realpathSync로 symlink를 실제 경로로 정규화해 경로 우회 공격 방지
const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
const MCP_BIN = join(ROOT, "packages/mcp/dist/bin.js");
// 루트에 락 파일 배치 — node_modules 안에 두면 ensureNodeModulesDir가 빈 디렉토리를 만들어
// isInstalled() 재체크 시 installed=true로 오판하는 문제가 생긴다
const LOCK_FILE = join(ROOT, ".mcp-bootstrap.lock");

// ─── 로그 헬퍼 (stderr 전용) ─────────────────────────────────────────

/** @param {string} msg */
function log(msg) {
  process.stderr.write(`[mcp-launcher] ${msg}\n`);
}

// ─── bootstrap.mjs 로드 ──────────────────────────────────────────────

const { isInstalled, isBuilt, isStale, planSteps, resolvePnpmCommand } = await import(
  new URL("./lib/bootstrap.mjs", import.meta.url).href
);

// ─── pnpm 명령 해석 ──────────────────────────────────────────────────

/**
 * PATH에서 명령어 존재 여부를 확인한다.
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
  log("오류: corepack 또는 pnpm을 찾을 수 없습니다. https://pnpm.io/installation 참고");
  process.exit(1);
}

// ─── 락 파일 유틸 ───────────────────────────────────────────────────

const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10분 상한
const POLL_INTERVAL_MS = 500;

/**
 * stale lock 감지: PID가 죽었거나 기록 시각이 LOCK_TIMEOUT_MS 초과면 stale.
 * @param {string} lockPath
 * @returns {boolean} stale이면 true
 */
function isStaleLock(lockPath) {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    let pid, time;
    try {
      ({ pid, time } = JSON.parse(raw));
    } catch {
      // 구버전(숫자만 기록) 또는 깨진 파일 → stale
      return true;
    }
    if (!Number.isInteger(pid) || pid <= 0) return true;
    // 기록 시각이 LOCK_TIMEOUT_MS 초과면 PID 살아있어도 stale
    if (typeof time === "number" && Date.now() - time > LOCK_TIMEOUT_MS) return true;
    // 프로세스 존재 확인 (kill 0은 신호를 보내지 않고 존재만 확인)
    process.kill(pid, 0);
    return false; // 살아있음
  } catch {
    return true; // ESRCH = 존재하지 않음 → stale
  }
}

/**
 * 락 파일 원자 획득 시도.
 * @returns {{ acquired: boolean, release: () => void }}
 */
async function acquireLock() {
  const startTime = Date.now();

  while (true) {
    try {
      // wx 플래그: 파일이 없을 때만 성공 (원자적 생성)
      const fd = openSync(LOCK_FILE, "wx");
      // fd에 직접 쓰기 — writeFileSync는 재오픈 없이 fd 사용 불가
      const content = JSON.stringify({ pid: process.pid, time: Date.now() });
      writeSync(fd, content);
      closeSync(fd);

      const release = () => {
        try { unlinkSync(LOCK_FILE); } catch { /* 무시 */ }
      };
      return { acquired: true, release };
    } catch (err) {
      // EEXIST 외 에러(EACCES, EROFS 등)는 락 경합이 아니라 환경 문제 → 즉시 종료
      if (err?.code && err.code !== "EEXIST") {
        log(`오류: 락 파일 생성 실패 (${err.code}): ${LOCK_FILE}. 권한 또는 파일시스템을 확인하세요.`);
        process.exit(1);
      }
      // EEXIST — 이미 락이 존재함 — stale 여부 확인
      if (existsSync(LOCK_FILE) && isStaleLock(LOCK_FILE)) {
        log("stale lock 감지, 탈취합니다...");
        try {
          unlinkSync(LOCK_FILE);
        } catch { /* 다른 프로세스가 이미 탈취했을 수 있음 */ }
        continue;
      }

      // 타임아웃 초과
      if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
        log("오류: 부트스트랩 락 획득 타임아웃 (10분). 수동으로 .mcp-bootstrap.lock을 삭제 후 재시도하세요.");
        process.exit(1);
      }

      // 폴링 대기
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

// ─── install / build 실행 ────────────────────────────────────────────

/**
 * pnpm/corepack 실행에 필요한 최소 env를 구성한다.
 * process.env 전체를 서브프로세스에 전파하지 않아 민감한 환경 변수 노출을 방지한다.
 * @returns {Record<string, string>}
 */
function buildMinimalEnv() {
  const e = process.env;
  /** @type {Record<string, string>} */
  const env = {};

  // 공통 필수 항목
  const common = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"];
  for (const key of common) {
    if (e[key] !== undefined) env[key] = e[key];
  }

  // Node.js / pnpm / corepack 관련
  const nodeKeys = [
    "NODE_PATH", "NODE_OPTIONS",
    "npm_config_user_agent",
    "PNPM_HOME",
    "COREPACK_HOME",
  ];
  for (const key of nodeKeys) {
    if (e[key] !== undefined) env[key] = e[key];
  }

  // Windows 전용 필수 항목
  if (process.platform === "win32") {
    const winKeys = [
      "SystemRoot", "COMSPEC",
      "APPDATA", "LOCALAPPDATA",
      "USERPROFILE",
      "ProgramFiles", "ProgramFiles(x86)",
    ];
    for (const key of winKeys) {
      if (e[key] !== undefined) env[key] = e[key];
    }
  }

  return env;
}

/**
 * spawnSync로 명령 실행. stdout을 stderr로 리다이렉트.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 */
function runSync(cmd, args, cwd) {
  const isWin = process.platform === "win32";
  // env 최소화: pnpm/corepack 동작에 필요한 항목만 명시 전달
  // (프로세스 전체 env를 서브프로세스에 전파하지 않아 환경 변수 누수 방지)
  const minimalEnv = buildMinimalEnv();
  const result = spawnSync(cmd, args, {
    cwd,
    // stdout → stderr (MCP 프로토콜 채널 보호), stderr → 그대로
    stdio: ["ignore", 2, 2],
    // Windows에서 .cmd 래퍼(corepack/pnpm)는 CVE-2024-27980 패치 이후
    // shell 없이 spawnSync하면 EINVAL 발생. 인자는 전부 하드코딩 상수라 injection 불가.
    shell: isWin,
    env: minimalEnv,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} 실패 (exit code: ${result.status})`);
  }
}

// ─── 메인 로직 ──────────────────────────────────────────────────────

async function main() {
  const installed = isInstalled(ROOT);
  const built = isBuilt(ROOT);
  const stale = isStale(ROOT);
  const steps = planSteps({ installed, built, stale });

  if (steps.length === 0) {
    // 이미 준비됨 — 바로 핸드오프
    handoff();
    return;
  }

  // 락 획득 후 부트스트랩 수행
  log("부트스트랩 시작 (첫 실행 시 수 분이 소요될 수 있습니다)...");
  const { release } = await acquireLock();

  try {
    // 락 획득 후 상태 재확인 (다른 프로세스가 이미 완료했을 수 있음)
    const installedNow = isInstalled(ROOT);
    const builtNow = isBuilt(ROOT);
    const staleNow = isStale(ROOT);
    const stepsNow = planSteps({ installed: installedNow, built: builtNow, stale: staleNow });

    for (const step of stepsNow) {
      if (step === "install") {
        log(`pnpm install 실행 중... (${pnpmCmd.cmd} ${[...pnpmCmd.args, "install"].join(" ")})`);
        runSync(pnpmCmd.cmd, [...pnpmCmd.args, "install"], ROOT);
        log("pnpm install 완료");
      } else if (step === "build") {
        log(`pnpm -r build 실행 중...`);
        // core를 먼저 단독 빌드해 의존 패키지들의 타입 선언을 확보한 후 전체 빌드
        // pnpm -r build가 workspace 의존성 순서를 항상 보장하지 않는 환경 대비
        runSync(pnpmCmd.cmd, [...pnpmCmd.args, "--filter", "@karax/core", "build"], ROOT);
        runSync(pnpmCmd.cmd, [...pnpmCmd.args, "-r", "build"], ROOT);
        log("빌드 완료");
      }
    }
  } finally {
    release();
  }

  handoff();
}

// WASM Turboshaft 워크어라운드 플래그.
// Node v24 V8 Turboshaft가 tree-sitter-swift.wasm을 백그라운드 컴파일할 때
// Zone OOM으로 프로세스가 즉사한다 (iOS 어댑터 사용 시 100% 재현).
// packages/adapter-ios/vitest.config.ts에 동일한 워크어라운드 적용돼 있음.
// V8 플래그는 NODE_OPTIONS 허용 목록에 없어 환경 변수 전달 불가 → execArgv로만 가능.
const WASM_FLAGS = [
  "--no-wasm-tier-up",
  "--no-wasm-dynamic-tiering",
  "--wasm-num-compilation-tasks=1",
];

/**
 * packages/mcp/dist/bin.js로 stdio 상속 핸드오프.
 * exit code를 그대로 전파하고, SIGINT/SIGTERM을 자식에게 전달한다.
 */
function handoff() {
  if (!existsSync(MCP_BIN)) {
    log(`오류: ${MCP_BIN}를 찾을 수 없습니다. 빌드가 정상적으로 완료됐는지 확인하세요.`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [...WASM_FLAGS, MCP_BIN], {
    stdio: "inherit",
    env: process.env,
  });

  // SIGINT/SIGTERM 자식에게 전달
  const forwardSignal = (/** @type {NodeJS.Signals} */ sig) => {
    child.kill(sig);
  };
  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("exit", (code, signal) => {
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

main().catch((err) => {
  log(`치명적 오류: ${err?.message ?? String(err)}`);
  process.exit(1);
});
