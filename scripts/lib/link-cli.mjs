/**
 * scripts/lib/link-cli.mjs — CLI 글로벌 링크 순수 결정 로직
 *
 * 외부 의존성 0. fs 주입 가능 구조로 완전한 단위 테스트 지원.
 * 부수효과(spawn, 로그 출력)는 link-cli.mjs에서만 수행한다.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";

// ─── isCliBuilt ─────────────────────────────────────────────────────

/**
 * CLI 빌드 산출물(packages/cli/dist/bin.js)이 존재하는지 확인한다.
 *
 * @param {string} root - 프로젝트 루트 경로
 * @param {{ existsSync: (p: string) => boolean }} [fsImpl] - fs 주입 (기본: node:fs)
 * @returns {boolean}
 */
export function isCliBuilt(root, fsImpl) {
  const fs = fsImpl ?? nodeFs;
  const cliBin = nodePath.join(root, "packages/cli/dist/bin.js");
  return fs.existsSync(cliBin);
}

// ─── buildLinkArgs ───────────────────────────────────────────────────

/**
 * pnpm link --global 실행에 필요한 명령 인자를 생성한다.
 * 원본 pnpmCmd 객체를 변경하지 않는다.
 *
 * @param {{ cmd: string, args: string[] }} pnpmCmd - resolvePnpmCommand 결과
 * @returns {{ cmd: string, args: string[] }}
 */
export function buildLinkArgs(pnpmCmd) {
  return {
    cmd: pnpmCmd.cmd,
    args: [...pnpmCmd.args, "link", "--global"],
  };
}

// ─── resolveWhichCommand ────────────────────────────────────────────

/**
 * 플랫폼에 맞는 PATH 검색 명령을 반환한다.
 *
 * @param {string} platform - process.platform 값
 * @returns {"which" | "where"}
 */
export function resolveWhichCommand(platform) {
  return platform === "win32" ? "where" : "which";
}

// ─── buildMinimalEnv ────────────────────────────────────────────────

/**
 * pnpm/corepack 실행에 필요한 최소 환경변수 세트를 반환한다.
 * process.env 전체를 자식 프로세스에 전파하지 않아 민감 정보(API 키 등) 노출을 방지한다.
 * mcp-launcher.mjs의 동일한 화이트리스트 로직을 순수 함수 형태로 분리한 것이다.
 *
 * @param {Record<string, string | undefined>} processEnv - 환경변수 맵 (테스트 시 주입)
 * @param {string} platform - process.platform 값 (테스트 시 주입)
 * @returns {Record<string, string>}
 */
export function buildMinimalEnv(processEnv, platform) {
  /** @type {Record<string, string>} */
  const env = {};

  // 공통 필수 항목
  const common = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"];
  for (const key of common) {
    if (processEnv[key] !== undefined) env[key] = /** @type {string} */ (processEnv[key]);
  }

  // Node.js / pnpm / corepack 관련
  const nodeKeys = [
    "NODE_PATH",
    "NODE_OPTIONS",
    "npm_config_user_agent",
    "PNPM_HOME",
    "COREPACK_HOME",
  ];
  for (const key of nodeKeys) {
    if (processEnv[key] !== undefined) env[key] = /** @type {string} */ (processEnv[key]);
  }

  // Windows 전용 필수 항목
  if (platform === "win32") {
    const winKeys = [
      "SystemRoot",
      "COMSPEC",
      "APPDATA",
      "LOCALAPPDATA",
      "USERPROFILE",
      "ProgramFiles",
      "ProgramFiles(x86)",
    ];
    for (const key of winKeys) {
      if (processEnv[key] !== undefined) env[key] = /** @type {string} */ (processEnv[key]);
    }
  }

  return env;
}
