/**
 * scripts/lib/bootstrap.mjs — 부트스트랩 순수 결정 로직
 *
 * 외부 의존성 0. node:fs 주입 가능 구조로 완전한 단위 테스트 지원.
 * 부수효과(spawn, 로그 출력)는 mcp-launcher.mjs에서만 수행한다.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";

// ─── isInstalled ────────────────────────────────────────────────────

/**
 * node_modules 디렉토리가 존재하는지 확인한다.
 * @param {string} root - 프로젝트 루트 경로
 * @param {{ existsSync: (p: string) => boolean }} [fsImpl] - fs 주입 (기본: node:fs)
 * @returns {boolean}
 */
export function isInstalled(root, fsImpl) {
  const fs = fsImpl ?? nodeFs;
  return fs.existsSync(nodePath.join(root, "node_modules"));
}

// ─── isBuilt ────────────────────────────────────────────────────────

/**
 * MCP 서버와 SDK의 dist 파일이 모두 존재하는지 확인한다.
 * @param {string} root - 프로젝트 루트 경로
 * @param {{ existsSync: (p: string) => boolean }} [fsImpl] - fs 주입
 * @returns {boolean}
 */
export function isBuilt(root, fsImpl) {
  const fs = fsImpl ?? nodeFs;
  const mcpBin = nodePath.join(root, "packages/mcp/dist/bin.js");
  const sdkIndex = nodePath.join(root, "packages/sdk/dist/index.js");
  return fs.existsSync(mcpBin) && fs.existsSync(sdkIndex);
}

// ─── isStale ────────────────────────────────────────────────────────

/**
 * src 파일의 최신 mtime이 dist보다 크면 stale(재빌드 필요)로 판정한다.
 * SFC_FORCE_REBUILD=1 환경변수가 설정되면 무조건 true를 반환한다.
 *
 * @param {string} root - 프로젝트 루트 경로
 * @param {{ statSync: (p: string) => { mtimeMs: number }, readdirSync: (p: string, opts?: unknown) => Array<{ name: string, isDirectory: () => boolean }> }} [fsImpl] - fs 주입
 * @param {Record<string, string | undefined>} [env] - 환경변수 맵 (기본: process.env)
 * @returns {boolean}
 */
export function isStale(root, fsImpl, env) {
  const envMap = env ?? process.env;

  // SFC_FORCE_REBUILD=1이면 무조건 재빌드
  if (envMap.SFC_FORCE_REBUILD === "1") return true;

  const fs = fsImpl ?? nodeFs;

  try {
    // packages/mcp/src + packages/sdk/src 아래 파일들의 최신 mtime 계산
    const srcDirs = [
      nodePath.join(root, "packages/mcp/src"),
      nodePath.join(root, "packages/sdk/src"),
    ];

    let maxSrcMtime = 0;

    /** @param {string} dir */
    function walkSrc(dir) {
      /** @type {Array<{ name: string, isDirectory: () => boolean }>} */
      let entries;
      try {
        entries = /** @type {Array<{ name: string, isDirectory: () => boolean }>} */ (
          fs.readdirSync(dir, { withFileTypes: true })
        );
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = nodePath.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkSrc(full);
        } else {
          try {
            const stat = fs.statSync(full);
            if (stat.mtimeMs > maxSrcMtime) maxSrcMtime = stat.mtimeMs;
          } catch {
            // stat 실패 무시
          }
        }
      }
    }

    for (const srcDir of srcDirs) {
      walkSrc(srcDir);
    }

    // src 파일이 없으면 판정 불가 → 안전하게 false 반환
    if (maxSrcMtime === 0) return false;

    // packages/mcp/dist/bin.js와 packages/sdk/dist/index.js mtime과 비교
    // 둘 중 하나라도 src보다 오래됐으면 stale
    const distTargets = [
      nodePath.join(root, "packages/mcp/dist/bin.js"),
      nodePath.join(root, "packages/sdk/dist/index.js"),
    ];
    for (const distTarget of distTargets) {
      const distStat = fs.statSync(distTarget);
      if (maxSrcMtime > distStat.mtimeMs) return true;
    }
    return false;
  } catch {
    // stat 실패(dist 없음 등) → 재빌드 필요
    return true;
  }
}

// ─── planSteps ──────────────────────────────────────────────────────

/**
 * 현재 상태에 따라 수행해야 할 단계를 결정한다.
 *
 * @param {{ installed: boolean, built: boolean, stale: boolean }} state
 * @returns {Array<"install" | "build">}
 */
export function planSteps({ installed, built, stale }) {
  const steps = [];

  if (!installed) {
    steps.push("install");
    // 미설치면 dist도 신뢰할 수 없으므로 항상 빌드
    if (!built || stale) steps.push("build");
    // 미설치인데 built이고 fresh: install만 (dist 파일은 이미 있음)
    return steps;
  }

  // 설치됨
  if (!built || stale) {
    steps.push("build");
  }

  return steps;
}

// ─── resolvePnpmCommand ─────────────────────────────────────────────

/**
 * 사용 가능한 pnpm 실행 방법을 결정한다.
 * corepack 우선, pnpm 직접 실행 fallback, 둘 다 없으면 null.
 *
 * @param {{ hasPnpmOnPath: boolean, hasCorepack: boolean }} opts
 * @returns {{ cmd: string, args: string[] } | null}
 */
export function resolvePnpmCommand({ hasPnpmOnPath, hasCorepack }) {
  if (hasCorepack) {
    return { cmd: "corepack", args: ["pnpm"] };
  }
  if (hasPnpmOnPath) {
    return { cmd: "pnpm", args: [] };
  }
  return null;
}
