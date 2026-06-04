/**
 * 에러 분류 단위 테스트 (TDD Red → Green)
 * CompileCaptureError 구조 + classifyGradleError 분기 검증
 */

import { describe, it, expect } from "vitest";
import {
  CompileCaptureError,
  classifyGradleError,
} from "../errors.js";

describe("CompileCaptureError", () => {
  it("name이 CompileCaptureError 이어야 함", () => {
    const err = new CompileCaptureError("SDK_MISSING", "no sdk", "");
    expect(err.name).toBe("CompileCaptureError");
  });

  it("code 필드에 분류 코드가 담겨야 함", () => {
    const err = new CompileCaptureError("COMPILE_FAILED", "fail", "stderr");
    expect(err.code).toBe("COMPILE_FAILED");
    expect(err.stderr).toBe("stderr");
  });

  it("instanceof Error === true", () => {
    const err = new CompileCaptureError("TIMEOUT", "timed out", "");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof CompileCaptureError).toBe(true);
  });

  it("모든 코드 타입이 허용됨", () => {
    const codes = [
      "SDK_MISSING",
      "DEPENDENCY_FAILED",
      "COMPILE_FAILED",
      "TEST_FAILED",
      "TIMEOUT",
    ] as const;
    for (const code of codes) {
      const err = new CompileCaptureError(code, "msg", "");
      expect(err.code).toBe(code);
    }
  });
});

describe("classifyGradleError", () => {
  it("exitCode=0 → null 반환", () => {
    expect(classifyGradleError(0, "", "")).toBeNull();
  });

  it("Android SDK 누락 패턴 → SDK_MISSING", () => {
    const stderr = "SDK location not found. Define location with sdk.dir in local.properties";
    const result = classifyGradleError(1, stderr, "");
    expect(result?.code).toBe("SDK_MISSING");
  });

  it("ANDROID_HOME 누락 → SDK_MISSING", () => {
    const stderr = "ANDROID_HOME is not set and android home is not set.";
    const result = classifyGradleError(1, stderr, "");
    expect(result?.code).toBe("SDK_MISSING");
  });

  it("의존성 해석 실패 → DEPENDENCY_FAILED", () => {
    const stderr = "Could not resolve com.android.tools.build:gradle:8.5.2";
    const result = classifyGradleError(1, stderr, "");
    expect(result?.code).toBe("DEPENDENCY_FAILED");
  });

  it("Could not download → DEPENDENCY_FAILED", () => {
    const stderr = "Could not download artifact some.package:1.0.0";
    const result = classifyGradleError(1, stderr, "");
    expect(result?.code).toBe("DEPENDENCY_FAILED");
  });

  it("Kotlin 컴파일 에러 → COMPILE_FAILED", () => {
    const stderr = "error: unresolved reference: HomeScreen\nHomeScreen.kt:10:5: error:";
    const result = classifyGradleError(1, stderr, "");
    expect(result?.code).toBe("COMPILE_FAILED");
  });

  it("Gradle task 실패 (Test failed) → TEST_FAILED", () => {
    const stdout = "1 tests completed, 1 failed\nFAILURE: Build failed";
    const result = classifyGradleError(1, "", stdout);
    expect(result?.code).toBe("TEST_FAILED");
  });

  it("타임아웃 신호 → TIMEOUT", () => {
    const err = new CompileCaptureError("TIMEOUT", "Process timed out", "");
    expect(err.code).toBe("TIMEOUT");
  });

  it("알 수 없는 실패 → TEST_FAILED 폴백", () => {
    const result = classifyGradleError(1, "some unknown error output", "");
    expect(result?.code).toBe("TEST_FAILED");
  });

  it("stderr가 비어도 폴백 반환", () => {
    const result = classifyGradleError(1, "", "");
    expect(result).not.toBeNull();
    expect(result?.code).toBeTruthy();
  });
});
