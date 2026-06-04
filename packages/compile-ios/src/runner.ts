/**
 * compile-ios — xcodebuild 실행기
 *
 * 책임:
 * - xcrun simctl list로 사용 가능한 시뮬레이터 동적 선택
 * - xcodebuild test 실행 (타임아웃 600s)
 * - PNG 파일 회수 (outPath에 이미 생성됨)
 * - 에러 분류: SIM_UNAVAILABLE / COMPILE_FAILED / TEST_FAILED / TIMEOUT
 * - finally: workDir 정리 (simctl shutdown은 하지 않음 — 공유 시뮬레이터 상태 존중)
 */

import * as path from "path";
import * as fs from "fs";
import { execa } from "execa";
import { selectSimulator } from "./harness/generator.js";
import type { SimulatorInfo } from "./harness/generator.js";

// ── 에러 타입 ──────────────────────────────────────────────────────────────────

export type CompileErrorCode =
  | "SIM_UNAVAILABLE"
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
 * xcodebuild 종료코드와 출력에서 에러 분류를 수행한다.
 * exit 0이면 null 반환.
 */
export function classifyXcodebuildError(
  exitCode: number,
  stderr: string,
  stdout: string
): CompileCaptureError | null {
  if (exitCode === 0) return null;

  const combined = `${stderr}\n${stdout}`.toLowerCase();

  // 타임아웃
  if (exitCode === -1 || combined.includes("etimedout") || combined.includes("timed out")) {
    return new CompileCaptureError("TIMEOUT", "xcodebuild 타임아웃", stderr);
  }

  // 시뮬레이터 없음
  if (
    combined.includes("unable to find a destination") ||
    combined.includes("unable to find a device or simulator") ||
    combined.includes("no simulators") ||
    combined.includes("sim_unavailable") ||
    combined.includes("could not find device") ||
    combined.includes("matching the provided destination")
  ) {
    return new CompileCaptureError(
      "SIM_UNAVAILABLE",
      `iOS 시뮬레이터를 찾을 수 없음: ${extractSnippet(stderr || stdout, 300)}`,
      stderr
    );
  }

  // Swift 컴파일 에러
  if (
    combined.includes(".swift:") && combined.includes("error:") ||
    combined.includes("** build failed **") ||
    combined.includes("compilation failed") ||
    combined.includes("build failure") ||
    (combined.includes("error:") && combined.includes("sources/"))
  ) {
    return new CompileCaptureError(
      "COMPILE_FAILED",
      `Swift 컴파일 실패: ${extractSnippet(stderr, 500)}`,
      stderr
    );
  }

  // 테스트 실패
  if (
    combined.includes("** test failed **") ||
    combined.includes("test case") && combined.includes("failed") ||
    combined.includes("xctest") && combined.includes("fail") ||
    combined.includes("xctassert")
  ) {
    return new CompileCaptureError(
      "TEST_FAILED",
      `xcodebuild test 실패: ${extractSnippet(stdout || stderr, 300)}`,
      stderr
    );
  }

  // 알 수 없는 실패 — TEST_FAILED로 폴백
  return new CompileCaptureError(
    "TEST_FAILED",
    `xcodebuild 실패 (exit ${exitCode}): ${extractSnippet(`${stderr}\n${stdout}`, 300)}`,
    stderr
  );
}

function extractSnippet(text: string, maxLen: number): string {
  return text.trim().slice(0, maxLen).replace(/\s+/g, " ");
}

// ── simctl 시뮬레이터 탐색 ─────────────────────────────────────────────────────

/**
 * xcrun simctl list로 사용 가능한 iOS 시뮬레이터를 탐색한다.
 */
export async function detectAvailableSimulator(): Promise<SimulatorInfo | null> {
  try {
    // 콜드스타트 환경에서 simctl list가 30s+ 소요 가능 → 60s timeout
    const result = await execa("xcrun", ["simctl", "list", "devices", "available"], {
      timeout: 60_000,
      reject: false,
    });
    if (result.exitCode !== 0) return null;
    return selectSimulator(result.stdout ?? "");
  } catch {
    return null;
  }
}

// ── xcodebuild 가용성 확인 ────────────────────────────────────────────────────

export async function isXcodebuildAvailable(): Promise<boolean> {
  try {
    // 느린 머신(콜드스타트 20s+)에서 병렬 테스트 실행 시 60s+ 소요 가능 → 90s
    const result = await execa("xcodebuild", ["-version"], {
      timeout: 90_000,
      reject: false,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function hasIosSimulatorRuntime(): Promise<boolean> {
  const sim = await detectAvailableSimulator();
  return sim !== null;
}

// ── xcodebuild 실행 ───────────────────────────────────────────────────────────

export interface RunnerOptions {
  workDir: string;
  schemeName: string;
  outPath: string;
  outDir: string;
  simulator: SimulatorInfo;
  derivedDataPath?: string;
  timeoutMs?: number;
  keepWorkDir?: boolean;
}

export interface RunnerResult {
  pngPath: string;
  width: number;
  height: number;
}

/**
 * workDir에서 xcodebuild test를 실행하고 PNG를 outDir로 복사한다.
 */
export async function runXcodebuildTest(opts: RunnerOptions): Promise<RunnerResult> {
  const {
    workDir,
    schemeName,
    outPath,
    outDir,
    simulator,
    timeoutMs = 600_000,
    keepWorkDir = false,
  } = opts;

  const derivedDataPath =
    opts.derivedDataPath ?? path.join(workDir, "DerivedData");

  try {
    let xcodebuildResult: Awaited<ReturnType<typeof execa>>;

    try {
      xcodebuildResult = await execa(
        "xcodebuild",
        [
          "test",
          "-scheme", schemeName,
          "-destination", `platform=iOS Simulator,id=${simulator.udid}`,
          "-derivedDataPath", derivedDataPath,
        ],
        {
          cwd: workDir,
          timeout: timeoutMs,
          reject: false,
        }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ETIMEDOUT") || msg.includes("timed out")) {
        throw new CompileCaptureError("TIMEOUT", "xcodebuild test 타임아웃", "");
      }
      throw new CompileCaptureError(
        "TEST_FAILED",
        `xcodebuild 실행 중 오류: ${msg}`,
        ""
      );
    }

    if (xcodebuildResult.exitCode !== 0) {
      const stderr = typeof xcodebuildResult.stderr === "string" ? xcodebuildResult.stderr : "";
      const stdout = typeof xcodebuildResult.stdout === "string" ? xcodebuildResult.stdout : "";
      const err = classifyXcodebuildError(xcodebuildResult.exitCode ?? 1, stderr, stdout);
      throw err ?? new CompileCaptureError("TEST_FAILED", "xcodebuild test 실패", stderr);
    }

    // PNG 확인 (하니스 테스트가 outPath에 직접 write)
    if (!fs.existsSync(outPath)) {
      throw new CompileCaptureError(
        "TEST_FAILED",
        `PNG 파일이 생성되지 않음: ${outPath}`,
        ""
      );
    }

    // outDir로 복사
    fs.mkdirSync(outDir, { recursive: true });
    const pngFileName = path.basename(outPath);
    const destPath = path.join(outDir, pngFileName);
    fs.copyFileSync(outPath, destPath);

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

// ── PNG 크기 파싱 ──────────────────────────────────────────────────────────────

/**
 * PNG 파일 헤더(IHDR chunk)에서 width/height를 읽는다.
 */
function readPngSize(pngPath: string): { width: number; height: number } {
  try {
    const fd = fs.openSync(pngPath, "r");
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}
