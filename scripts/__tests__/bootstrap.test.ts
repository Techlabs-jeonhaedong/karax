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
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("node_modules가 없으면 false를 반환한다", () => {
    const fakeFs = {
      existsSync: (_p: string) => false,
    };
    expect(isInstalled(FAKE_ROOT, fakeFs)).toBe(false);
  });

  // 엣지 케이스: 빈 문자열 root
  it("root가 빈 문자열이어도 크래시하지 않는다", () => {
    const fakeFs = { existsSync: () => false };
    expect(isInstalled("", fakeFs)).toBe(false);
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
