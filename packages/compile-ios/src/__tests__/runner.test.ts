/**
 * compile-ios — runner 에러 분류 유닛 테스트
 * TDD Red 단계: 구현 전 먼저 작성
 */
import { describe, expect, it } from "vitest";
import { classifyXcodebuildError, CompileCaptureError } from "../runner.js";

describe("classifyXcodebuildError", () => {
  it("exit 0이면 null 반환", () => {
    const result = classifyXcodebuildError(0, "", "");
    expect(result).toBeNull();
  });

  it("시뮬레이터 없음 → SIM_UNAVAILABLE", () => {
    const result = classifyXcodebuildError(
      1,
      "Unable to find a destination matching the provided destination specifier",
      ""
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("SIM_UNAVAILABLE");
  });

  it("No simulators → SIM_UNAVAILABLE", () => {
    const result = classifyXcodebuildError(
      1,
      "error: Unable to find a device or simulator",
      ""
    );
    expect(result!.code).toBe("SIM_UNAVAILABLE");
  });

  it("Swift 컴파일 에러 → COMPILE_FAILED", () => {
    const result = classifyXcodebuildError(
      65,
      "/path/HomeScreen.swift:12:5: error: use of unresolved identifier 'unknownFunc'",
      ""
    );
    expect(result!.code).toBe("COMPILE_FAILED");
  });

  it("Build FAILED → COMPILE_FAILED", () => {
    const result = classifyXcodebuildError(
      65,
      "** BUILD FAILED **",
      "error: compilation failed"
    );
    expect(result!.code).toBe("COMPILE_FAILED");
  });

  it("테스트 실패 → TEST_FAILED", () => {
    const result = classifyXcodebuildError(
      1,
      "** TEST FAILED **",
      "Test Case '-[CaptureTests.CaptureTest testCapture]' failed"
    );
    expect(result!.code).toBe("TEST_FAILED");
  });

  it("타임아웃 → TIMEOUT", () => {
    const result = classifyXcodebuildError(
      -1,
      "ETIMEDOUT",
      ""
    );
    expect(result!.code).toBe("TIMEOUT");
  });

  it("알 수 없는 exit → TEST_FAILED로 폴백", () => {
    const result = classifyXcodebuildError(1, "unknown error output", "");
    expect(result).not.toBeNull();
    expect(result!.code).toBe("TEST_FAILED");
  });

  it("CompileCaptureError는 Error 인스턴스", () => {
    const err = new CompileCaptureError("COMPILE_FAILED", "test", "stderr text");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CompileCaptureError");
    expect(err.code).toBe("COMPILE_FAILED");
    expect(err.stderr).toBe("stderr text");
  });
});
