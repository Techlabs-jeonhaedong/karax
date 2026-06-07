/**
 * packages/cli/src/debug.ts 단위 테스트 (Phase C-1)
 *
 * 불변 제약:
 * - resolveDebug: 명시 플래그 > KARAX_DEBUG=1 > false 우선순위
 * - printError off: 기존 console.error("오류:", message)와 byte-identical
 * - printError on: E2eError code/details 추가, Error stack 추가
 * - 출력 직전 redactSecrets 통과
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// console.error 스파이
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

let resolveDebug: (flagValue: boolean | undefined, env: NodeJS.ProcessEnv) => boolean;
let printError: (e: unknown, debug: boolean) => void;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import("../debug.js");
  resolveDebug = mod.resolveDebug;
  printError = mod.printError;
});

afterEach(() => {
  // 환경 변수 복원은 테스트 내부에서 처리
});

// ── resolveDebug ───────────────────────────────────────────────────────────

describe("resolveDebug", () => {
  it("명시 플래그 true는 env 무관하게 true를 반환한다", () => {
    expect(resolveDebug(true, {})).toBe(true);
    expect(resolveDebug(true, { KARAX_DEBUG: "1" })).toBe(true);
    expect(resolveDebug(true, { KARAX_DEBUG: "0" })).toBe(true);
  });

  it("명시 플래그 false는 env 무관하게 false를 반환한다", () => {
    expect(resolveDebug(false, {})).toBe(false);
    expect(resolveDebug(false, { KARAX_DEBUG: "1" })).toBe(false);
  });

  it("플래그 미지정(undefined) + KARAX_DEBUG=1이면 true를 반환한다", () => {
    expect(resolveDebug(undefined, { KARAX_DEBUG: "1" })).toBe(true);
  });

  it("플래그 미지정(undefined) + KARAX_DEBUG=0이면 false를 반환한다", () => {
    expect(resolveDebug(undefined, { KARAX_DEBUG: "0" })).toBe(false);
  });

  it("플래그 미지정(undefined) + KARAX_DEBUG 없으면 false를 반환한다", () => {
    expect(resolveDebug(undefined, {})).toBe(false);
  });

  it("플래그 미지정(undefined) + KARAX_DEBUG=true (문자열)이면 false를 반환한다 ('1'만 truthy)", () => {
    expect(resolveDebug(undefined, { KARAX_DEBUG: "true" })).toBe(false);
  });
});

// ── printError off ─────────────────────────────────────────────────────────

describe("printError — debug=false (기존 포맷 byte-identical)", () => {
  it("일반 Error를 debug=false로 출력하면 '오류: <message>' 형태이다", () => {
    const err = new Error("테스트 오류 메시지");
    printError(err, false);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const [label, msg] = consoleErrorSpy.mock.calls[0] as [string, string];
    expect(label).toBe("오류:");
    expect(msg).toBe("테스트 오류 메시지");
  });

  it("문자열 오류를 debug=false로 출력하면 '오류: <string>' 형태이다", () => {
    printError("문자열 에러", false);
    const [label, msg] = consoleErrorSpy.mock.calls[0] as [string, string];
    expect(label).toBe("오류:");
    expect(msg).toBe("문자열 에러");
  });

  it("debug=false 시 stderr에 추가 출력이 없다", () => {
    printError(new Error("msg"), false);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

// ── printError on ──────────────────────────────────────────────────────────

describe("printError — debug=true (추가 정보 포함)", () => {
  it("debug=true + Error 시 stderr에 stack이 출력된다", () => {
    const err = new Error("디버그 오류");
    printError(err, true);
    // console.error는 기존 포맷 그대로
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    // stderr에 stack 추가
    expect(stderrSpy).toHaveBeenCalled();
    const stderrOutput = (stderrSpy.mock.calls as unknown[][])
      .map((args) => String(args[0]))
      .join("");
    expect(stderrOutput).toContain("stack");
  });

  it("debug=true + API 키가 포함된 에러는 stderr에서 redact된다", () => {
    const err = new Error("claude sk-ant-api03-abcdefghijklmn12345 failed");
    printError(err, true);
    const stderrOutput = (stderrSpy.mock.calls as unknown[][])
      .map((args) => String(args[0]))
      .join("");
    expect(stderrOutput).not.toContain("sk-ant-api03-abcdefghijklmn12345");
    expect(stderrOutput).toContain("[REDACTED]");
  });

  it("debug=true + 제어문자 포함 에러는 stderr에서 strip된다", () => {
    const err = new Error("오류\x00숨김\x01텍스트");
    printError(err, true);
    const stderrOutput = (stderrSpy.mock.calls as unknown[][])
      .map((args) => String(args[0]))
      .join("");
    expect(stderrOutput).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });

  it("debug=true + ESC(\\x1b) ANSI 시퀀스는 stderr 출력에서 strip된다 (ANSI 주입 방지)", () => {
    // ANSI 색상 코드 (\x1b[31m 악성 \x1b[0m) 포함 에러
    const err = new Error("\x1b[31m악성\x1b[0m");
    printError(err, true);
    const stderrOutput = (stderrSpy.mock.calls as unknown[][])
      .map((args) => String(args[0]))
      .join("");
    // ESC 문자(0x1b)가 출력에 없어야 한다
    expect(stderrOutput).not.toContain("\x1b");
  });

  it("debug=true + stack에 ESC 포함 시 stderr에서 ESC가 제거된다", () => {
    const err = new Error("test");
    // stack 프로퍼티를 덮어씌워 ANSI 주입 시뮬레이션
    err.stack = "\x1b[32mError: test\x1b[0m\n    at fake:1:1";
    printError(err, true);
    const stderrOutput = (stderrSpy.mock.calls as unknown[][])
      .map((args) => String(args[0]))
      .join("");
    expect(stderrOutput).not.toContain("\x1b");
  });
});
