/**
 * scripts/lib/link-cli.mjs 단위 테스트 (TDD Red → Green)
 *
 * 순수 함수(isCliBuilt, buildLinkArgs, resolveWhichCommand, buildMinimalEnv)만 테스트한다.
 * spawnSync 등 부수효과 코드는 link-cli.mjs에서 분리하여 테스트 대상에서 제외한다.
 */

import { describe, it, expect } from "vitest";

const linkCliUrl = new URL("../lib/link-cli.mjs", import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

mod = await import(linkCliUrl.href);

const { isCliBuilt, buildLinkArgs, resolveWhichCommand, buildMinimalEnv } = mod;

const FAKE_ROOT = "/fake/project";

// ─── isCliBuilt ─────────────────────────────────────────────────────

describe("isCliBuilt", () => {
  it("packages/cli/dist/bin.js가 있으면 true를 반환한다", () => {
    const fakeFs = {
      existsSync: (p: string) => p === `${FAKE_ROOT}/packages/cli/dist/bin.js`,
    };
    expect(isCliBuilt(FAKE_ROOT, fakeFs)).toBe(true);
  });

  it("packages/cli/dist/bin.js가 없으면 false를 반환한다", () => {
    const fakeFs = { existsSync: () => false };
    expect(isCliBuilt(FAKE_ROOT, fakeFs)).toBe(false);
  });

  it("root가 빈 문자열이어도 크래시하지 않는다", () => {
    const fakeFs = { existsSync: () => false };
    expect(isCliBuilt("", fakeFs)).toBe(false);
  });

  it("다른 경로가 존재해도 bin.js가 없으면 false를 반환한다", () => {
    const fakeFs = {
      existsSync: (p: string) => p === `${FAKE_ROOT}/packages/cli/dist/index.js`,
    };
    expect(isCliBuilt(FAKE_ROOT, fakeFs)).toBe(false);
  });
});

// ─── buildLinkArgs ───────────────────────────────────────────────────

describe("buildLinkArgs", () => {
  it("corepack pnpm 명령일 때 link --global 인자를 올바르게 생성한다", () => {
    const pnpmCmd = { cmd: "corepack", args: ["pnpm"] };
    expect(buildLinkArgs(pnpmCmd)).toEqual({
      cmd: "corepack",
      args: ["pnpm", "link", "--global"],
    });
  });

  it("pnpm 직접 명령일 때 link --global 인자를 올바르게 생성한다", () => {
    const pnpmCmd = { cmd: "pnpm", args: [] };
    expect(buildLinkArgs(pnpmCmd)).toEqual({
      cmd: "pnpm",
      args: ["link", "--global"],
    });
  });

  it("원본 pnpmCmd 객체를 변경하지 않는다 (불변성)", () => {
    const pnpmCmd = { cmd: "pnpm", args: [] };
    buildLinkArgs(pnpmCmd);
    expect(pnpmCmd.args).toEqual([]);
  });

  it("args에 추가 플래그가 있을 때도 올바르게 link --global을 붙인다", () => {
    const pnpmCmd = { cmd: "corepack", args: ["pnpm"] };
    const result = buildLinkArgs(pnpmCmd);
    expect(result.args).toEqual(["pnpm", "link", "--global"]);
  });
});

// ─── resolveWhichCommand ────────────────────────────────────────────

describe("resolveWhichCommand", () => {
  it("win32에서 'where'를 반환한다", () => {
    expect(resolveWhichCommand("win32")).toBe("where");
  });

  it("darwin에서 'which'를 반환한다", () => {
    expect(resolveWhichCommand("darwin")).toBe("which");
  });

  it("linux에서 'which'를 반환한다", () => {
    expect(resolveWhichCommand("linux")).toBe("which");
  });

  it("알 수 없는 플랫폼에서 'which'를 반환한다 (안전 fallback)", () => {
    expect(resolveWhichCommand("aix")).toBe("which");
  });

  it("빈 문자열 플랫폼에서 'which'를 반환한다 (방어적 처리)", () => {
    expect(resolveWhichCommand("")).toBe("which");
  });
});

// ─── buildMinimalEnv ────────────────────────────────────────────────

describe("buildMinimalEnv", () => {
  it("화이트리스트 키(PATH, HOME, PNPM_HOME 등)만 결과에 포함한다", () => {
    const fakeEnv = {
      PATH: "/usr/bin",
      HOME: "/Users/test",
      PNPM_HOME: "/Users/test/.pnpm",
      ANTHROPIC_API_KEY: "sk-secret",
      NPM_TOKEN: "npm-token",
    };
    const result = buildMinimalEnv(fakeEnv, "darwin");
    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/Users/test");
    expect(result.PNPM_HOME).toBe("/Users/test/.pnpm");
  });

  it("민감 키(ANTHROPIC_API_KEY, NPM_TOKEN)는 결과에서 제외한다", () => {
    const fakeEnv = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-secret",
      NPM_TOKEN: "npm-token",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
    };
    const result = buildMinimalEnv(fakeEnv, "darwin");
    expect(result).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(result).not.toHaveProperty("NPM_TOKEN");
    expect(result).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });

  it("값이 undefined인 키는 결과에 포함하지 않는다", () => {
    const fakeEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      HOME: undefined,
      PNPM_HOME: undefined,
    };
    const result = buildMinimalEnv(fakeEnv, "darwin");
    expect(result).toHaveProperty("PATH");
    expect(result).not.toHaveProperty("HOME");
    expect(result).not.toHaveProperty("PNPM_HOME");
  });

  it("win32에서는 Windows 전용 키(SystemRoot, COMSPEC 등)를 포함한다", () => {
    const fakeEnv = {
      PATH: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      USERPROFILE: "C:\\Users\\test",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    };
    const result = buildMinimalEnv(fakeEnv, "win32");
    expect(result.SystemRoot).toBe("C:\\Windows");
    expect(result.COMSPEC).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(result.APPDATA).toBe("C:\\Users\\test\\AppData\\Roaming");
    expect(result.LOCALAPPDATA).toBe("C:\\Users\\test\\AppData\\Local");
    expect(result.USERPROFILE).toBe("C:\\Users\\test");
    expect(result.ProgramFiles).toBe("C:\\Program Files");
    expect(result["ProgramFiles(x86)"]).toBe("C:\\Program Files (x86)");
  });

  it("win32가 아닌 플랫폼(darwin/linux)에서는 Windows 전용 키를 포함하지 않는다", () => {
    const fakeEnv = {
      PATH: "/usr/bin",
      SystemRoot: "C:\\Windows",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
    };
    const result = buildMinimalEnv(fakeEnv, "darwin");
    expect(result).not.toHaveProperty("SystemRoot");
    expect(result).not.toHaveProperty("COMSPEC");

    const resultLinux = buildMinimalEnv(fakeEnv, "linux");
    expect(resultLinux).not.toHaveProperty("SystemRoot");
  });

  it("빈 env를 넘기면 빈 객체를 반환한다", () => {
    const result = buildMinimalEnv({}, "darwin");
    expect(result).toEqual({});
  });

  it("NODE_OPTIONS, NODE_PATH, npm_config_user_agent, COREPACK_HOME을 포함한다", () => {
    const fakeEnv = {
      NODE_OPTIONS: "--max-old-space-size=4096",
      NODE_PATH: "/usr/local/lib/node_modules",
      npm_config_user_agent: "pnpm/8.0.0",
      COREPACK_HOME: "/Users/test/.corepack",
    };
    const result = buildMinimalEnv(fakeEnv, "darwin");
    expect(result.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    expect(result.NODE_PATH).toBe("/usr/local/lib/node_modules");
    expect(result.npm_config_user_agent).toBe("pnpm/8.0.0");
    expect(result.COREPACK_HOME).toBe("/Users/test/.corepack");
  });
});
