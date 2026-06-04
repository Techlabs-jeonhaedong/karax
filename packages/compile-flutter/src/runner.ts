import * as path from "path";
import * as fs from "fs";
import { execa } from "execa";

// ── 에러 타입 ──────────────────────────────────────────────────────────────────

export type CompileErrorCode =
  | "PUB_GET_FAILED"
  | "COMPILE_FAILED"
  | "TEST_FAILED"
  | "TIMEOUT"
  | "UNINJECTABLE_PARAM";

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
 * flutter 실행 종료코드와 출력에서 에러 분류를 수행한다.
 * 종료코드 0이면 null 반환.
 */
export function classifyRunnerError(
  exitCode: number,
  stderr: string,
  stdout: string
): CompileCaptureError | null {
  if (exitCode === 0) return null;

  const combined = `${stderr}\n${stdout}`.toLowerCase();

  // pub get 실패 패턴 — dependency resolution 관련 키워드로 좁게 매치
  // "resolving dependencies" / "version solving" 이 핵심 신호
  if (
    combined.includes("resolving dependencies") ||
    combined.includes("version solving failed") ||
    combined.includes("version solve failed") ||
    combined.includes("could not satisfy constraints")
  ) {
    const snippet = extractSnippet(stderr || stdout, 500);
    return new CompileCaptureError("PUB_GET_FAILED", `flutter pub get 실패: ${snippet}`, stderr);
  }

  // Dart 컴파일/타입 에러 패턴
  if (
    combined.includes(": error:") ||
    combined.includes(".dart:") && combined.includes("error:") ||
    combined.includes("method not found") ||
    combined.includes("undefined name") ||
    combined.includes("can't be assigned") ||
    combined.includes("expected") && combined.includes("error") ||
    combined.includes("compilation failed") ||
    combined.includes("lib/") && combined.includes("error") ||
    combined.includes("test/") && combined.includes("error")
  ) {
    const snippet = extractSnippet(stderr, 500);
    return new CompileCaptureError("COMPILE_FAILED", `Dart 컴파일 에러: ${snippet}`, stderr);
  }

  // 테스트 실패 패턴
  if (
    combined.includes("some tests failed") ||
    combined.includes("failed") && combined.includes("+0") ||
    combined.includes(": test failed")
  ) {
    const snippet = extractSnippet(stdout || stderr, 300);
    return new CompileCaptureError("TEST_FAILED", `flutter test 실패: ${snippet}`, stderr);
  }

  // 알 수 없는 실패 — TEST_FAILED로 폴백
  const snippet = extractSnippet(`${stderr}\n${stdout}`, 300);
  return new CompileCaptureError("TEST_FAILED", `flutter 실행 실패 (exit ${exitCode}): ${snippet}`, stderr);
}

/** 긴 문자열을 maxLen으로 잘라 반환 */
function extractSnippet(text: string, maxLen: number): string {
  return text.trim().slice(0, maxLen).replace(/\s+/g, " ");
}

// ── flutter 실행 ───────────────────────────────────────────────────────────────

export interface RunnerOptions {
  workDir: string;
  goldenPath: string;
  outDir: string;
  flutterPath?: string;
  timeoutMs?: number;
  keepWorkDir?: boolean;
}

export interface RunnerResult {
  pngPath: string;
  width: number;
  height: number;
}

/**
 * workDir에서 flutter pub get + flutter test --update-goldens를 실행하고
 * 생성된 PNG를 outDir로 이동한다.
 */
export async function runFlutterTest(opts: RunnerOptions): Promise<RunnerResult> {
  const {
    workDir,
    goldenPath,
    outDir,
    flutterPath = "flutter",
    timeoutMs = 180_000,
    keepWorkDir = false,
  } = opts;

  try {
    // Step 1: flutter pub get (오프라인 먼저, 실패 시 온라인)
    await runPubGet(workDir, flutterPath, timeoutMs);

    // Step 2: flutter test --update-goldens
    await runTestWithGolden(workDir, flutterPath, timeoutMs);

    // Step 3: 골든 PNG 회수
    const pngFileName = path.basename(goldenPath);
    // flutter test golden 파일 위치: test/goldens/<name>.png
    const goldenDir = path.dirname(goldenPath);
    const actualGoldenPath = findGoldenFile(workDir, pngFileName, goldenDir);

    if (!actualGoldenPath || !fs.existsSync(actualGoldenPath)) {
      throw new CompileCaptureError(
        "TEST_FAILED",
        `골든 PNG 파일을 찾을 수 없음: ${goldenPath}`,
        ""
      );
    }

    // outDir로 복사
    fs.mkdirSync(outDir, { recursive: true });
    const destPath = path.join(outDir, pngFileName);
    fs.copyFileSync(actualGoldenPath, destPath);

    // PNG 크기 읽기 (PNG 헤더에서)
    const { width, height } = readPngSize(destPath);

    return { pngPath: destPath, width, height };
  } finally {
    if (!keepWorkDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // 정리 실패는 무시
      }
    }
  }
}

/** flutter pub get 실행 */
async function runPubGet(
  workDir: string,
  flutterPath: string,
  timeoutMs: number
): Promise<void> {
  // 오프라인 먼저 시도
  try {
    await execa(flutterPath, ["pub", "get", "--offline"], {
      cwd: workDir,
      timeout: timeoutMs / 2,
      reject: true,
    });
    return;
  } catch {
    // 오프라인 실패 — 온라인 시도
  }

  try {
    const result = await execa(flutterPath, ["pub", "get"], {
      cwd: workDir,
      timeout: timeoutMs / 2,
      reject: false,
    });

    if (result.exitCode !== 0) {
      const err = classifyRunnerError(
        result.exitCode ?? 1,
        result.stderr ?? "",
        result.stdout ?? ""
      );
      throw err ?? new CompileCaptureError("PUB_GET_FAILED", "flutter pub get 실패", result.stderr ?? "");
    }
  } catch (e) {
    if (e instanceof CompileCaptureError) throw e;

    // execa 타임아웃
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ETIMEDOUT") || msg.includes("timed out")) {
      throw new CompileCaptureError("TIMEOUT", "flutter pub get 타임아웃", "");
    }
    throw new CompileCaptureError("PUB_GET_FAILED", `flutter pub get 실행 중 오류: ${msg}`, "");
  }
}

/** flutter test --update-goldens 실행 */
async function runTestWithGolden(
  workDir: string,
  flutterPath: string,
  timeoutMs: number
): Promise<void> {
  let result: Awaited<ReturnType<typeof execa>>;

  try {
    result = await execa(
      flutterPath,
      ["test", "--update-goldens", "test/screen_capture_test.dart"],
      {
        cwd: workDir,
        timeout: timeoutMs,
        reject: false,
        env: {
          ...process.env,
          FLUTTER_TEST: "true",
        },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ETIMEDOUT") || msg.includes("timed out")) {
      throw new CompileCaptureError("TIMEOUT", "flutter test 타임아웃", "");
    }
    throw new CompileCaptureError(
      "TEST_FAILED",
      `flutter test 실행 중 오류: ${msg}`,
      ""
    );
  }

  if (result.exitCode !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const err = classifyRunnerError(result.exitCode ?? 1, stderr, stdout);
    throw err ?? new CompileCaptureError("TEST_FAILED", "flutter test 실패", stderr);
  }
}

/**
 * workDir 내에서 골든 PNG 파일을 탐색한다.
 * flutter test golden 파일 위치는 테스트 파일과 같은 디렉토리 또는 goldens/ 서브디렉토리.
 */
function findGoldenFile(workDir: string, fileName: string, expectedDir: string): string | null {
  // 1) 기대 경로 (test/goldens/<name>.png)
  if (fs.existsSync(expectedDir)) {
    const p = path.join(expectedDir, fileName);
    if (fs.existsSync(p)) return p;
  }

  // 2) test/ 디렉토리 직접
  const testDir = path.join(workDir, "test");
  const p2 = path.join(testDir, fileName);
  if (fs.existsSync(p2)) return p2;

  // 3) 재귀 탐색
  return findFileRecursive(workDir, fileName);
}

function findFileRecursive(dir: string, fileName: string): string | null {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          const found = findFileRecursive(full, fileName);
          if (found) return found;
        } else if (entry === fileName) {
          return full;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ── PNG 크기 파싱 ──────────────────────────────────────────────────────────────

/**
 * PNG 파일 헤더(IHDR chunk)에서 width/height를 읽는다.
 * IHDR: 바이트 16-23 (width 4바이트 big-endian, height 4바이트 big-endian)
 */
function readPngSize(pngPath: string): { width: number; height: number } {
  try {
    const fd = fs.openSync(pngPath, "r");
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);

    // PNG 시그니처: 8바이트
    // IHDR 청크: 길이(4) + "IHDR"(4) + 너비(4) + 높이(4)
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}
