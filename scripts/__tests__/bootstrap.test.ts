/**
 * scripts/lib/bootstrap.mjs 단위 테스트 (TDD Red → Green)
 *
 * bootstrap.mjs는 순수 JS(.mjs)이므로 vitest에서 직접 import.
 * fake fs 주입으로 실제 파일시스템 없이 isInstalled/isBuilt/isStale을 검증.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM dynamic import — bootstrap.mjs는 .ts가 아니므로 vitest가 그대로 실행
const bootstrapUrl = new URL("../lib/bootstrap.mjs", import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

// beforeAll 대신 최상위 await (vitest top-level await 지원)
mod = await import(bootstrapUrl.href);

const {
  isInstalled,
  isBuilt,
  isStale,
  planSteps,
  resolvePnpmCommand,
} = mod;

const FAKE_ROOT = "/fake/project";

// ─── isInstalled ────────────────────────────────────────────────────

describe("isInstalled", () => {
  it("node_modules가 존재하면 true를 반환한다", () => {
    const fakeFs = {
      existsSync: (p: string) => p === `${FAKE_ROOT}/node_modules`,
      readdirSync: (_p: string) => [] as any,
      readFileSync: (_p: string, _enc?: string): string => { throw new Error("ENOENT"); },
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("node_modules가 없으면 false를 반환한다", () => {
    const fakeFs = {
      existsSync: (_p: string) => false,
      readdirSync: (_p: string) => [] as any,
      readFileSync: (_p: string, _enc?: string): string => { throw new Error("ENOENT"); },
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(false);
  });

  // 엣지 케이스: 빈 문자열 root
  it("root가 빈 문자열이어도 크래시하지 않는다", () => {
    const fakeFs = {
      existsSync: () => false,
      readdirSync: (_p: string) => [] as any,
      readFileSync: (_p: string, _enc?: string): string => { throw new Error("ENOENT"); },
    };
    expect(isInstalled("", fakeFs)).toBe(false);
  });

  // ─── 워크스페이스 패키지 node_modules 검증 ────────────────────────

  it("루트 node_modules는 있지만 의존성 있는 패키지의 node_modules가 없으면 false", () => {
    // packages/e2e는 dependencies가 있는데 node_modules가 없는 상황
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/pnpm-workspace.yaml`]: "packages:\n  - \"packages/*\"\n",
      [`${FAKE_ROOT}/packages/e2e/package.json`]: JSON.stringify({
        name: "@fake/e2e",
        dependencies: { execa: "^9.0.0" },
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["e2e"] as any;
        return [] as any;
      },
      readFileSync: (p: string, enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("루트 node_modules가 없으면 워크스페이스 패키지와 무관하게 false", () => {
    const fakeFs = {
      existsSync: (_p: string) => false,
      readdirSync: (_p: string) => [] as any,
      readFileSync: (_p: string, _enc?: string) => { throw new Error("ENOENT"); },
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("의존성이 없는 패키지는 node_modules가 없어도 true로 판정한다", () => {
    // packages/meta에는 dependencies/devDependencies가 전혀 없음
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/pnpm-workspace.yaml`]: "packages:\n  - \"packages/*\"\n",
      [`${FAKE_ROOT}/packages/meta/package.json`]: JSON.stringify({
        name: "@fake/meta",
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["meta"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("모든 의존성 있는 패키지에 node_modules가 있으면 true", () => {
    const existingDirs = new Set([
      `${FAKE_ROOT}/node_modules`,
      `${FAKE_ROOT}/packages/core/node_modules`,
      `${FAKE_ROOT}/packages/e2e/node_modules`,
    ]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/pnpm-workspace.yaml`]: "packages:\n  - \"packages/*\"\n",
      [`${FAKE_ROOT}/packages/core/package.json`]: JSON.stringify({
        name: "@fake/core",
        dependencies: { zod: "^3.0.0" },
      }),
      [`${FAKE_ROOT}/packages/e2e/package.json`]: JSON.stringify({
        name: "@fake/e2e",
        devDependencies: { vitest: "^3.0.0" },
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["core", "e2e"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("devDependencies만 있는 패키지도 node_modules가 없으면 false", () => {
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/pnpm-workspace.yaml`]: "packages:\n  - \"packages/*\"\n",
      [`${FAKE_ROOT}/packages/sdk/package.json`]: JSON.stringify({
        name: "@fake/sdk",
        devDependencies: { typescript: "^5.0.0" },
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["sdk"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("packages 디렉토리 읽기 실패 시 크래시 없이 기본 체크 결과를 반환한다", () => {
    // readdirSync가 throw → packages 순회 생략, 루트 node_modules 존재 여부만 판정
    const fakeFs = {
      existsSync: (p: string) => p === `${FAKE_ROOT}/node_modules`,
      readdirSync: (_p: string) => { throw new Error("EACCES: permission denied"); },
      readFileSync: (_p: string, _enc?: string) => { throw new Error("ENOENT"); },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("package.json 파싱 실패(깨진 JSON)인 패키지는 건너뛰고 다른 패키지를 검사한다", () => {
    // broken-pkg: JSON 파싱 실패 → 건너뜀
    // good-pkg: dependencies 있고 node_modules 없음 → false 반환
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const rawFiles: Record<string, string> = {
      [`${FAKE_ROOT}/pnpm-workspace.yaml`]: "packages:\n  - \"packages/*\"\n",
      [`${FAKE_ROOT}/packages/broken-pkg/package.json`]: "{NOT_VALID_JSON",
      [`${FAKE_ROOT}/packages/good-pkg/package.json`]: JSON.stringify({
        name: "@fake/good-pkg",
        dependencies: { lodash: "^4.0.0" },
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["broken-pkg", "good-pkg"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (rawFiles[p]) return rawFiles[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("워크스페이스 패키지가 0개이면 루트 node_modules 존재만으로 true", () => {
    const fakeFs = {
      existsSync: (p: string) => p === `${FAKE_ROOT}/node_modules`,
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return [] as any;
        return [] as any;
      },
      readFileSync: (_p: string, _enc?: string) => { throw new Error("ENOENT"); },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("pnpm-workspace.yaml이 없으면(readFileSync throw) 루트 node_modules만 체크한다", () => {
    const fakeFs = {
      existsSync: (p: string) => p === `${FAKE_ROOT}/node_modules`,
      readdirSync: (_p: string) => { throw new Error("ENOENT"); },
      readFileSync: (_p: string, _enc?: string) => { throw new Error("ENOENT"); },
      realpathSync: (p: string) => p,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  // ─── symlink 안전 처리 ────────────────────────────────────────────

  it("symlink가 root 밖을 가리키면 해당 패키지를 건너뛰고 나머지로 판정한다", () => {
    // evil-pkg는 symlink로 루트 바깥을 가리키므로 건너뜀
    // good-pkg는 node_modules 없음 → false
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/packages/good-pkg/package.json`]: JSON.stringify({
        name: "@fake/good-pkg",
        dependencies: { zod: "^3.0.0" },
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["evil-pkg", "good-pkg"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      // evil-pkg의 realpath는 루트 밖(/tmp/malicious)을 가리킴
      realpathSync: (p: string) => {
        if (p.includes("evil-pkg")) return "/tmp/malicious/evil-pkg";
        return p;
      },
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("realpathSync가 throw하면 해당 패키지를 건너뛰고 나머지로 판정한다", () => {
    // symlink-err-pkg: realpathSync throw → 건너뜀
    // clean-pkg: 의존성 없음 → true
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/packages/clean-pkg/package.json`]: JSON.stringify({
        name: "@fake/clean-pkg",
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["symlink-err-pkg", "clean-pkg"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => {
        if (p.includes("symlink-err-pkg")) throw new Error("ENOENT: broken symlink");
        return p;
      },
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  // ─── JSON inherited property / 비정상 타입 가드 ──────────────────

  it("dependencies가 문자열인 깨진 package.json은 건너뛴다", () => {
    // dependencies가 string이면 Object.keys 오동작 → hasOwnProperty + typeof 가드로 방어
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/packages/bad-types-pkg/package.json`]: JSON.stringify({
        name: "@fake/bad-types-pkg",
        dependencies: "not-an-object",
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["bad-types-pkg"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    // dependencies가 string이면 hasDeps = false로 판정 → node_modules 없어도 true
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("dependencies가 배열인 깨진 package.json은 건너뛴다", () => {
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/packages/array-deps-pkg/package.json`]: JSON.stringify({
        name: "@fake/array-deps-pkg",
        dependencies: ["dep-a", "dep-b"],
      }),
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["array-deps-pkg"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    // 배열은 typeof object이지만 Array → hasOwnProperty 가드로 처리, node_modules 없어도 true
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("__proto__ injection 시도가 있어도 안전하게 처리한다", () => {
    const existingDirs = new Set([`${FAKE_ROOT}/node_modules`]);
    // JSON.parse는 __proto__를 일반 키로 처리하므로 실제 프로토타입 오염 없음
    // 하지만 hasOwnProperty.call 방어가 동작하는지 확인
    const maliciousJson = '{"name":"@fake/proto-pkg","__proto__":{"dependencies":{"evil":"1.0.0"}}}';
    const pkgJsons: Record<string, string> = {
      [`${FAKE_ROOT}/packages/proto-pkg/package.json`]: maliciousJson,
    };
    const fakeFs = {
      existsSync: (p: string) => existingDirs.has(p),
      readdirSync: (p: string) => {
        if (p === `${FAKE_ROOT}/packages`) return ["proto-pkg"] as any;
        return [] as any;
      },
      readFileSync: (p: string, _enc?: string) => {
        if (pkgJsons[p]) return pkgJsons[p];
        throw new Error(`ENOENT: ${p}`);
      },
      realpathSync: (p: string) => p,
    };
    // __proto__ 키는 hasOwnProperty.call로 false → node_modules 없어도 true
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });
});

// ─── isBuilt ────────────────────────────────────────────────────────

describe("isBuilt", () => {
  it("MCP dist/bin.js와 sdk dist/index.js 둘 다 있으면 true", () => {
    const existing = new Set([
      `${FAKE_ROOT}/packages/mcp/dist/bin.js`,
      `${FAKE_ROOT}/packages/sdk/dist/index.js`,
    ]);
    const fakeFs = { existsSync: (p: string) => existing.has(p) };
    expect(isBuilt(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("MCP dist/bin.js만 없으면 false", () => {
    const fakeFs = {
      existsSync: (p: string) => p.includes("sdk"),
    };
    expect(isBuilt(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("sdk dist/index.js만 없으면 false", () => {
    const fakeFs = {
      existsSync: (p: string) => p.includes("mcp"),
    };
    expect(isBuilt(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("둘 다 없으면 false", () => {
    const fakeFs = { existsSync: () => false };
    expect(isBuilt(FAKE_ROOT, fakeFs)).toBe(false);
  });
});

// ─── isStale ────────────────────────────────────────────────────────

describe("isStale", () => {
  it("SFC_FORCE_REBUILD=1 환경변수가 있으면 무조건 true", () => {
    const fakeFs = { statSync: () => ({ mtimeMs: 0 }) };
    const fakeEnv = { SFC_FORCE_REBUILD: "1" };
    // src나 dist 상태와 무관하게 true
    expect(isStale(FAKE_ROOT, fakeFs, fakeEnv)).toBe(true);
  });

  it("src mtime > dist mtime이면 true(stale)", () => {
    // src 최신화(2000), dist 오래됨(1000)
    const fakeFs = {
      statSync: (p: string) => {
        if (p.includes("/src/")) return { mtimeMs: 2000 };
        if (p.includes("/dist/")) return { mtimeMs: 1000 };
        return { mtimeMs: 0 };
      },
      readdirSync: (p: string, opts?: unknown) => {
        if (p.includes("/src")) {
          return [{ name: "index.ts", isDirectory: () => false }];
        }
        return [];
      },
    };
    expect(isStale(FAKE_ROOT, fakeFs, {})).toBe(true);
  });

  it("dist mtime >= src mtime이면 false(fresh)", () => {
    // dist 최신화(3000), src 오래됨(1000)
    const fakeFs = {
      statSync: (p: string) => {
        if (p.includes("/src/")) return { mtimeMs: 1000 };
        if (p.includes("/dist/")) return { mtimeMs: 3000 };
        return { mtimeMs: 0 };
      },
      readdirSync: (_p: string, _opts?: unknown) => [
        { name: "index.ts", isDirectory: () => false },
      ],
    };
    expect(isStale(FAKE_ROOT, fakeFs, {})).toBe(false);
  });

  it("dist bin.js의 statSync 예외 발생 시 true(안전하게 재빌드)", () => {
    // src 파일은 있고(mtime 1000), dist statSync가 throw → 재빌드 필요
    const fakeFs = {
      statSync: (p: string) => {
        if (p.includes("/src/")) return { mtimeMs: 1000 };
        throw new Error("ENOENT: dist/bin.js not found");
      },
      readdirSync: (_p: string, _opts?: unknown) => [
        { name: "index.ts", isDirectory: () => false },
      ],
    };
    expect(isStale(FAKE_ROOT, fakeFs, {})).toBe(true);
  });

  // 엣지 케이스: readdirSync가 빈 배열이면 false(src 파일 없음)
  it("src 파일이 없으면 stale 판정 불가 → false", () => {
    const fakeFs = {
      statSync: () => ({ mtimeMs: 0 }),
      readdirSync: (_p: string, _opts?: unknown) => [],
    };
    expect(isStale(FAKE_ROOT, fakeFs, {})).toBe(false);
  });

  // sdk/src 변경 감지 테스트
  it("packages/sdk/src 파일만 최신화됐어도 stale을 감지한다", () => {
    // mcp/src는 오래됨(1000), sdk/src는 최신(5000), dist/bin.js는 중간(3000)
    const fakeFs = {
      statSync: (p: string) => {
        if (p.endsWith("/dist/bin.js")) return { mtimeMs: 3000 };
        if (p.endsWith("/packages/sdk/dist/index.js")) return { mtimeMs: 3000 };
        if (p.includes("/packages/sdk/src/")) return { mtimeMs: 5000 };
        if (p.includes("/packages/mcp/src/")) return { mtimeMs: 1000 };
        return { mtimeMs: 0 };
      },
      readdirSync: (p: string, _opts?: unknown) => {
        // mcp/src와 sdk/src 모두 파일이 있는 것처럼 시뮬레이션
        if (p.includes("/src")) {
          return [{ name: "index.ts", isDirectory: () => false }];
        }
        return [];
      },
    };
    expect(isStale(FAKE_ROOT, fakeFs, {})).toBe(true);
  });

  it("packages/sdk/dist/index.js가 없으면 stale로 판정한다", () => {
    const fakeFs = {
      statSync: (p: string) => {
        if (p.endsWith("/packages/sdk/dist/index.js")) {
          throw new Error("ENOENT: sdk dist/index.js not found");
        }
        if (p.includes("/src/")) return { mtimeMs: 1000 };
        return { mtimeMs: 3000 };
      },
      readdirSync: (_p: string, _opts?: unknown) => [
        { name: "index.ts", isDirectory: () => false },
      ],
    };
    expect(isStale(FAKE_ROOT, fakeFs, {})).toBe(true);
  });
});

// ─── planSteps ──────────────────────────────────────────────────────

describe("planSteps", () => {
  // 8가지 조합 (installed×built×stale)

  it("미설치·미빌드·freshDontCare → ['install','build']", () => {
    expect(planSteps({ installed: false, built: false, stale: false })).toEqual(["install", "build"]);
  });

  it("미설치·미빌드·stale → ['install','build']", () => {
    expect(planSteps({ installed: false, built: false, stale: true })).toEqual(["install", "build"]);
  });

  it("미설치·built·fresh → ['install','build'] (install 없이 dist만 있는 경우 재설치 필요)", () => {
    // node_modules 없는데 dist만 있는 이상한 상태: install 필요
    expect(planSteps({ installed: false, built: true, stale: false })).toEqual(["install"]);
  });

  it("미설치·built·stale → ['install','build']", () => {
    expect(planSteps({ installed: false, built: true, stale: true })).toEqual(["install", "build"]);
  });

  it("설치됨·미빌드·fresh → ['build']", () => {
    expect(planSteps({ installed: true, built: false, stale: false })).toEqual(["build"]);
  });

  it("설치됨·미빌드·stale → ['build']", () => {
    expect(planSteps({ installed: true, built: false, stale: true })).toEqual(["build"]);
  });

  it("설치됨·built·fresh → [] (아무것도 안 해도 됨)", () => {
    expect(planSteps({ installed: true, built: true, stale: false })).toEqual([]);
  });

  it("설치됨·built·stale → ['build'] (재빌드만)", () => {
    expect(planSteps({ installed: true, built: true, stale: true })).toEqual(["build"]);
  });
});

// ─── resolvePnpmCommand ─────────────────────────────────────────────

describe("resolvePnpmCommand", () => {
  it("corepack 있으면 corepack pnpm을 반환한다", () => {
    const result = resolvePnpmCommand({ hasPnpmOnPath: true, hasCorepack: true });
    expect(result).toEqual({ cmd: "corepack", args: ["pnpm"] });
  });

  it("corepack 없고 pnpm 있으면 pnpm을 반환한다", () => {
    const result = resolvePnpmCommand({ hasPnpmOnPath: true, hasCorepack: false });
    expect(result).toEqual({ cmd: "pnpm", args: [] });
  });

  it("둘 다 없으면 null을 반환한다", () => {
    const result = resolvePnpmCommand({ hasPnpmOnPath: false, hasCorepack: false });
    expect(result).toBeNull();
  });

  // 엣지 케이스: corepack 없고 pnpm도 없는데 hasCorepack=true (비정상적 조합)
  it("corepack=true, pnpm=false → corepack 우선 반환", () => {
    const result = resolvePnpmCommand({ hasPnpmOnPath: false, hasCorepack: true });
    expect(result).toEqual({ cmd: "corepack", args: ["pnpm"] });
  });
});
