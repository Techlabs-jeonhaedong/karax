/**
 * FVM(Flutter Version Manager) flutter 경로 resolve 유틸
 *
 * 우선순위 체인:
 *  1. <projectPath>/.fvm/flutter_sdk/bin/flutter  (FVM이 생성하는 심링크 — 존재 시 최우선)
 *  2. .fvmrc (FVM 3.x) 또는 .fvm/fvm_config.json (FVM 2.x) 에서 버전 파싱
 *  3. 파싱된 버전으로 SDK 캐시 탐색:
 *       - FVM_CACHE_PATH (3.x 환경변수) 또는 FVM_HOME (2.x 환경변수) → <cache>/versions/<ver>/bin/flutter
 *       - 없으면 <homeDir>/fvm/versions/<ver>/bin/flutter (기본 경로)
 *  4. 어느 것도 없으면 null 반환 → 호출자가 PATH fallback 처리
 *
 * node 내장(fs/path/os)만 사용해 외부 의존 없이 @karax/core 제약 내에서 동작한다.
 */

import fs from "fs";
import path from "path";
import os from "os";

// ── FVM 설정 파싱 ──────────────────────────────────────────────────────────────

interface FvmConfig {
  version: string;
  /** 설정 파일 종류 — "fvmrc" (3.x) | "fvm_config" (2.x) */
  source: "fvmrc" | "fvm_config";
}

/**
 * 프로젝트 루트에서 FVM 설정을 읽어 Flutter 버전을 반환한다.
 * .fvmrc (FVM 3.x) 를 먼저 시도하고, 없으면 .fvm/fvm_config.json (FVM 2.x) 를 시도한다.
 */
function readFvmConfig(projectPath: string): FvmConfig | null {
  // 1) .fvmrc (FVM 3.x)
  const fvmrcPath = path.join(projectPath, ".fvmrc");
  if (fileExists(fvmrcPath)) {
    const version = parseVersion(fvmrcPath, "flutter");
    if (version) return { version, source: "fvmrc" };
  }

  // 2) .fvm/fvm_config.json (FVM 2.x)
  const fvmConfigPath = path.join(projectPath, ".fvm", "fvm_config.json");
  if (fileExists(fvmConfigPath)) {
    const version = parseVersion(fvmConfigPath, "flutterSdkVersion");
    if (version) return { version, source: "fvm_config" };
  }

  return null;
}

/**
 * FVM 버전 문자열이 유효한지 검증한다.
 *
 * 허용: 영숫자·`.`·`-`·`_`·`+`·`@` 조합 (예: 3.19.0, stable, beta, 3.22.0-1.0.pre)
 * 거부: `..`, `/`, `\`, 절대경로 시작(`/`·`\`)이 포함된 모든 값
 */
function isValidVersion(version: string): boolean {
  // 빈 값 거부
  if (!version) return false;
  // 허용된 문자만 포함 여부 (화이트리스트)
  return /^[a-zA-Z0-9.\-_+@]+$/.test(version);
}

/**
 * JSON 파일에서 특정 키의 문자열 값을 읽는다.
 * 파싱 실패, 키 누락, 또는 유효하지 않은 버전 문자열이면 null 반환.
 */
function parseVersion(filePath: string, key: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== "string" || value.trim() === "") return null;
    const version = value.trim();
    if (!isValidVersion(version)) return null;
    return version;
  } catch {
    return null;
  }
}

// ── 캐시 경로 계산 ─────────────────────────────────────────────────────────────

/**
 * FVM SDK 캐시 루트를 결정한다.
 *
 * FVM_CACHE_PATH (3.x) → FVM_HOME (2.x) → <homeDir>/fvm 순서로 탐색.
 * 환경변수 값이 절대경로가 아닌 경우 무시한다.
 */
function resolveCacheRoot(
  env: Record<string, string | undefined>,
  homeDir: string
): string {
  if (env.FVM_CACHE_PATH && path.isAbsolute(env.FVM_CACHE_PATH)) return env.FVM_CACHE_PATH;
  if (env.FVM_HOME && path.isAbsolute(env.FVM_HOME)) return env.FVM_HOME;
  return path.join(homeDir, "fvm");
}

/** <cacheRoot>/versions/<version>/bin/flutter */
function buildCachedFlutterPath(cacheRoot: string, version: string): string {
  return path.join(cacheRoot, "versions", version, "bin", "flutter");
}

// ── 파일 존재 체크 ─────────────────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 프로젝트의 FVM 설정을 읽어 해당 Flutter SDK 실행파일 경로를 반환한다.
 *
 * @param projectPath  분석 대상 Flutter 프로젝트 루트 경로
 * @param env          프로세스 환경변수 (기본: process.env). 테스트에서 오버라이드 가능.
 * @param homeDir      사용자 홈 디렉토리 (기본: os.homedir()). 테스트에서 오버라이드 가능.
 * @returns            flutter 실행파일 절대경로, 또는 FVM 설정이 없거나 resolve 실패 시 null
 */
export async function resolveFlutterPath(
  projectPath: string,
  env: Record<string, string | undefined> = process.env,
  homeDir: string = os.homedir()
): Promise<string | null> {
  // 1) .fvm/flutter_sdk/bin/flutter 심링크 우선 — realpath 정규화 + 캐시 경계 검증
  const symlinkPath = path.join(projectPath, ".fvm", "flutter_sdk", "bin", "flutter");
  if (fileExists(symlinkPath)) {
    try {
      const realSymlink = fs.realpathSync(symlinkPath);
      const cacheRoot = resolveCacheRoot(env, homeDir);
      // 양쪽 다 realpath로 정규화해서 비교 (macOS /tmp → /private/tmp 이슈 방지)
      let realCacheRoot: string;
      try {
        realCacheRoot = fs.realpathSync(cacheRoot);
      } catch {
        // 캐시 루트가 아직 존재하지 않으면 정규화 불가 — 경계 밖으로 간주
        realCacheRoot = cacheRoot;
      }
      const normalizedCacheRoot = realCacheRoot.endsWith(path.sep)
        ? realCacheRoot
        : realCacheRoot + path.sep;
      if (realSymlink.startsWith(normalizedCacheRoot)) {
        return realSymlink;
      }
      // 캐시 밖을 가리키면 심링크 무시 → 설정 기반으로 fallback
    } catch {
      // realpathSync 실패 (깨진 심링크, 순환 등) → fallback
    }
  }

  // 2) FVM 설정 파일에서 버전 파싱
  const config = readFvmConfig(projectPath);
  if (!config) return null;

  // 3) 캐시에서 SDK 탐색
  const cacheRoot = resolveCacheRoot(env, homeDir);
  const cachedPath = buildCachedFlutterPath(cacheRoot, config.version);
  if (fileExists(cachedPath)) {
    return cachedPath;
  }

  return null;
}
