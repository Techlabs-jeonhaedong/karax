/**
 * CLI 커맨드 단위 테스트 (commander 파싱 중심)
 *
 * 빌드된 CLI를 실제로 실행하지 않고 내부 파서 함수를 직접 호출.
 * E2E(child_process) 테스트는 e2e.test.ts에서 별도 진행.
 */

import { describe, it, expect } from "vitest";
import {
  parseDetectArgs,
  parseDoctorArgs,
  parseListArgs,
  parseCaptureArgs,
  parseMcpConfigArgs,
  EXIT_CODES,
} from "../commands.js";

// ─── detect ────────────────────────────────────────────────────────

describe("parseDetectArgs", () => {
  it("경로 인수를 파싱한다", () => {
    const result = parseDetectArgs(["/some/project"]);
    expect(result.path).toBe("/some/project");
  });

  it("경로가 없으면 에러를 던진다", () => {
    expect(() => parseDetectArgs([])).toThrow();
  });
});

// ─── doctor ────────────────────────────────────────────────────────

describe("parseDoctorArgs", () => {
  it("경로 없이도 파싱된다 (옵셔널)", () => {
    const result = parseDoctorArgs([]);
    expect(result.path).toBeUndefined();
    expect(result.fix).toBe(false);
  });

  it("--fix 플래그를 파싱한다", () => {
    const result = parseDoctorArgs(["--fix"]);
    expect(result.fix).toBe(true);
  });

  it("경로와 --fix를 함께 파싱한다", () => {
    const result = parseDoctorArgs(["/some/project", "--fix"]);
    expect(result.path).toBe("/some/project");
    expect(result.fix).toBe(true);
  });

  it("경로를 먼저 받고 --fix를 뒤에 받아도 파싱된다", () => {
    const result = parseDoctorArgs(["--fix", "/some/project"]);
    expect(result.path).toBe("/some/project");
    expect(result.fix).toBe(true);
  });
});

// ─── list ──────────────────────────────────────────────────────────

describe("parseListArgs", () => {
  it("경로 인수를 파싱한다", () => {
    const result = parseListArgs(["/some/project"]);
    expect(result.path).toBe("/some/project");
    expect(result.includeCandidates).toBe(true); // 기본값
    expect(result.json).toBe(false);
  });

  it("--no-candidates로 includeCandidates=false 파싱", () => {
    const result = parseListArgs(["/p", "--no-candidates"]);
    expect(result.includeCandidates).toBe(false);
  });

  it("--include-candidates 플래그를 파싱한다", () => {
    const result = parseListArgs(["/p", "--include-candidates"]);
    expect(result.includeCandidates).toBe(true);
  });

  it("--json 플래그를 파싱한다", () => {
    const result = parseListArgs(["/p", "--json"]);
    expect(result.json).toBe(true);
  });

  it("경로가 없으면 에러를 던진다", () => {
    expect(() => parseListArgs([])).toThrow();
  });
});

// ─── capture ───────────────────────────────────────────────────────

describe("parseCaptureArgs", () => {
  it("경로만으로 파싱된다 (기본값 확인)", () => {
    const result = parseCaptureArgs(["/some/project"]);
    expect(result.path).toBe("/some/project");
    expect(result.screen).toBeUndefined();
    expect(result.device).toBeUndefined();
    expect(result.mode).toBe("auto");
    expect(result.out).toBeUndefined();
    expect(result.seed).toBeUndefined();
    expect(result.json).toBe(false);
  });

  it("--screen 옵션을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--screen", "HomeScreen"]);
    expect(result.screen).toBe("HomeScreen");
  });

  it("--device 옵션을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--device", "pixel-8"]);
    expect(result.device).toBe("pixel-8");
  });

  it("--mode compile을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--mode", "compile"]);
    expect(result.mode).toBe("compile");
  });

  it("--mode static을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--mode", "static"]);
    expect(result.mode).toBe("static");
  });

  it("잘못된 --mode 값이면 에러를 던진다", () => {
    expect(() => parseCaptureArgs(["/p", "--mode", "invalid"])).toThrow();
  });

  it("--out 옵션을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--out", "/tmp/out"]);
    expect(result.out).toBe("/tmp/out");
  });

  it("--seed 옵션을 파싱한다 (숫자로 변환)", () => {
    const result = parseCaptureArgs(["/p", "--seed", "42"]);
    expect(result.seed).toBe(42);
  });

  it("--json 플래그를 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--json"]);
    expect(result.json).toBe(true);
  });

  it("경로가 없으면 에러를 던진다", () => {
    expect(() => parseCaptureArgs([])).toThrow();
  });
});

// ─── mcp-config ────────────────────────────────────────────────────

describe("parseMcpConfigArgs", () => {
  it("인수 없이도 파싱된다", () => {
    const result = parseMcpConfigArgs([]);
    expect(result).toBeDefined();
  });
});

// ─── EXIT_CODES ────────────────────────────────────────────────────

describe("EXIT_CODES", () => {
  it("성공은 0", () => expect(EXIT_CODES.SUCCESS).toBe(0));
  it("부분 실패는 2", () => expect(EXIT_CODES.PARTIAL_FAILURE).toBe(2));
  it("실패는 1", () => expect(EXIT_CODES.FAILURE).toBe(1));
});
