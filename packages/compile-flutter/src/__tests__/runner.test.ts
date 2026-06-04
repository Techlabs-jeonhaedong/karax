import { describe, expect, it } from "vitest";
import { classifyRunnerError, CompileCaptureError } from "../runner.js";

// ── 에러 분류 단위 테스트 ──────────────────────────────────────────────────────

describe("classifyRunnerError", () => {
  it("pub get 실패 stderr는 PUB_GET_FAILED로 분류해야 한다", () => {
    const err = classifyRunnerError(1, "Because flutter_basic_fixture depends on...\nResolving dependencies...", "");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("PUB_GET_FAILED");
  });

  it("pub get 실패 — version solve 에러도 PUB_GET_FAILED", () => {
    const err = classifyRunnerError(1, "version solving failed\ncould not satisfy constraints", "");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("PUB_GET_FAILED");
  });

  it("컴파일 에러 stderr는 COMPILE_FAILED로 분류해야 한다", () => {
    const stderr = `
lib/main.dart:5:3: Error: Method not found: 'undefinedFunction'.
  undefinedFunction();
  ^^^^^^^^^^^^^^^^^
`;
    const err = classifyRunnerError(1, stderr, "");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("COMPILE_FAILED");
  });

  it("타입 에러 stderr도 COMPILE_FAILED여야 한다", () => {
    const stderr = "test/screen_capture_test.dart:10:5: Error: A value of type 'int' can't be assigned to a variable of type 'String'";
    const err = classifyRunnerError(1, stderr, "");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("COMPILE_FAILED");
  });

  it("테스트 실패 stdout은 TEST_FAILED로 분류해야 한다", () => {
    const stdout = "00:05 +0 -1: Some tests failed.";
    const err = classifyRunnerError(1, "", stdout);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("TEST_FAILED");
  });

  it("종료코드 0이면 null을 반환해야 한다 (에러 없음)", () => {
    const err = classifyRunnerError(0, "", "");
    expect(err).toBeNull();
  });

  it("CompileCaptureError는 code, message, stderr를 포함해야 한다", () => {
    const err = new CompileCaptureError("COMPILE_FAILED", "컴파일 에러", "Error: something");
    expect(err.code).toBe("COMPILE_FAILED");
    expect(err.message).toContain("컴파일 에러");
    expect(err.stderr).toBe("Error: something");
    expect(err instanceof Error).toBe(true);
  });

  it("TIMEOUT 에러를 생성할 수 있어야 한다", () => {
    const err = new CompileCaptureError("TIMEOUT", "타임아웃", "");
    expect(err.code).toBe("TIMEOUT");
  });

  it("알 수 없는 종료코드는 TEST_FAILED로 폴백해야 한다", () => {
    const err = classifyRunnerError(99, "some unknown output", "some stdout");
    expect(err).not.toBeNull();
    expect(err!.code).toBeDefined();
  });
});
