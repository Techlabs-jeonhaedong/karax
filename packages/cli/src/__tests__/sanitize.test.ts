/**
 * cli/sanitize.ts — 터미널 이스케이프 정화 헬퍼 테스트
 */

import { describe, it, expect } from "vitest";
import { stripControls } from "../sanitize.js";

describe("stripControls — 제어 문자 제거", () => {
  it("일반 문자열은 그대로 반환한다", () => {
    expect(stripControls("/path/to/scenario.md")).toBe("/path/to/scenario.md");
  });

  it("ANSI 이스케이프 시퀀스에서 \\x1b 제어 문자를 제거한다", () => {
    // \x1b(ESC)는 제어 문자이므로 제거, 나머지 출력 가능 문자([31m 등)는 유지
    const input = "\x1b[31mRED\x1b[0m";
    const result = stripControls(input);
    expect(result).not.toContain("\x1b");
    // 터미널에서 \x1b를 제거하면 시퀀스가 작동하지 않아 안전하다
    expect(result).toBe("[31mRED[0m");
  });

  it("OSC 시퀀스에서 \\x1b 제어 문자를 제거한다", () => {
    const input = "\x1b]8;;http://example.com\x1b\\link\x1b]8;;\x1b\\";
    const result = stripControls(input);
    expect(result).not.toContain("\x1b");
    // \x5c(\)는 출력 가능 문자이므로 유지됨
    expect(result).toContain("link");
  });

  it("NULL 바이트(\\x00)를 제거한다", () => {
    expect(stripControls("foo\x00bar")).toBe("foobar");
  });

  it("탭(\\t), 캐리지리턴(\\r), 개행(\\n)을 제거한다", () => {
    expect(stripControls("foo\tbar")).toBe("foobar");
    expect(stripControls("foo\rbar")).toBe("foobar");
    expect(stripControls("foo\nbar")).toBe("foobar");
  });

  it("\\x7f(DEL)을 제거한다", () => {
    expect(stripControls("foo\x7fbar")).toBe("foobar");
  });

  it("\\x00-\\x1f 범위 모두 제거한다", () => {
    // 0x01 ~ 0x1f까지 모두 삽입
    const ctrl = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join("");
    const result = stripControls(`before${ctrl}after`);
    expect(result).toBe("beforeafter");
  });

  it("멀티바이트 문자(한글, 이모지)는 그대로 유지한다", () => {
    expect(stripControls("한글 시나리오.md")).toBe("한글 시나리오.md");
    expect(stripControls("🚀 test.md")).toBe("🚀 test.md");
  });

  it("빈 문자열에도 안전하다", () => {
    expect(stripControls("")).toBe("");
  });

  it("이스케이프 포함 경로 → 출력에 \\x1b 미포함 (터미널 조작 방지)", () => {
    const maliciousPath = "/scenarios/\x1b[1mmalicious\x1b[0m/test.md";
    const result = stripControls(maliciousPath);
    expect(result).not.toContain("\x1b");
    // 경로 구조는 유지 (/ 와 텍스트 문자들)
    expect(result).toContain("malicious");
    expect(result).toContain("test.md");
  });
});
