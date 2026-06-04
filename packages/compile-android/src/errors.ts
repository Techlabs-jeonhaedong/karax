// ── 에러 코드 ──────────────────────────────────────────────────────────────────

export type CompileErrorCode =
  | "SDK_MISSING"
  | "DEPENDENCY_FAILED"
  | "COMPILE_FAILED"
  | "TEST_FAILED"
  | "TIMEOUT";

export class CompileCaptureError extends Error {
  constructor(
    public readonly code: CompileErrorCode,
    message: string,
    public readonly stderr: string = ""
  ) {
    super(message);
    this.name = "CompileCaptureError";
  }
}

// ── 에러 분류 ──────────────────────────────────────────────────────────────────

/**
 * Gradle 실행 종료코드와 출력에서 에러 분류를 수행한다.
 * 종료코드 0이면 null 반환.
 */
export function classifyGradleError(
  exitCode: number,
  stderr: string,
  stdout: string
): CompileCaptureError | null {
  if (exitCode === 0) return null;

  const combined = `${stderr}\n${stdout}`.toLowerCase();

  // Android SDK 누락
  if (
    combined.includes("sdk location not found") ||
    combined.includes("android_home is not set") ||
    combined.includes("android home is not set") ||
    combined.includes("failed to find target with hash string 'android-")
  ) {
    return new CompileCaptureError(
      "SDK_MISSING",
      `Android SDK 누락: ${extractSnippet(stderr || stdout, 300)}`,
      stderr
    );
  }

  // 의존성 해석 실패
  if (
    combined.includes("could not resolve") ||
    combined.includes("could not download") ||
    combined.includes("failed to resolve") ||
    combined.includes("network error") ||
    combined.includes("could not get resource")
  ) {
    return new CompileCaptureError(
      "DEPENDENCY_FAILED",
      `Gradle 의존성 실패: ${extractSnippet(stderr || stdout, 300)}`,
      stderr
    );
  }

  // 컴파일 에러
  if (
    combined.includes(": error:") ||
    combined.includes("compilation failed") ||
    combined.includes("unresolved reference") ||
    combined.includes("type mismatch") ||
    combined.includes("cannot find symbol") ||
    combined.includes(":compiledebugsources") ||
    combined.includes(":compiledebugkotlin") && combined.includes("error")
  ) {
    return new CompileCaptureError(
      "COMPILE_FAILED",
      `Kotlin/Java 컴파일 에러: ${extractSnippet(stderr, 300)}`,
      stderr
    );
  }

  // 테스트 실패
  if (
    combined.includes("tests completed") && combined.includes("failed") ||
    combined.includes("test failed") ||
    combined.includes("failure: build failed") ||
    combined.includes("paparazzi test failed")
  ) {
    return new CompileCaptureError(
      "TEST_FAILED",
      `Paparazzi 테스트 실패: ${extractSnippet(stdout || stderr, 300)}`,
      stderr
    );
  }

  // 폴백: TEST_FAILED
  return new CompileCaptureError(
    "TEST_FAILED",
    `Gradle 실행 실패 (exit ${exitCode}): ${extractSnippet(`${stderr}\n${stdout}`, 300)}`,
    stderr
  );
}

function extractSnippet(text: string, maxLen: number): string {
  return text.trim().slice(0, maxLen).replace(/\s+/g, " ");
}
