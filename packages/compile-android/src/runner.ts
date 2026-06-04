import path from "path";
import fs from "fs";
import { execa } from "execa";
import {
  CompileCaptureError,
  classifyGradleError,
  type CompileErrorCode,
} from "./errors.js";

export { CompileCaptureError, classifyGradleError };
export type { CompileErrorCode };

// ── 실행기 인터페이스 ──────────────────────────────────────────────────────────

export interface RunnerOptions {
  workDir: string;
  snapshotDir: string;
  screenName: string;
  outDir: string;
  gradlePath?: string;
  androidSdkPath?: string;
  timeoutMs?: number;
  keepWorkDir?: boolean;
}

export interface RunnerResult {
  pngPath: string;
  width: number;
  height: number;
}

// ── local.properties 생성 ──────────────────────────────────────────────────────

function writeLocalProperties(workDir: string, sdkPath: string): void {
  const content = `sdk.dir=${sdkPath.replace(/\\/g, "\\\\")}\n`;
  fs.writeFileSync(path.join(workDir, "local.properties"), content, "utf-8");
}

// ── Gradle 실행 ───────────────────────────────────────────────────────────────

/**
 * workDir에서 Gradle testDebugUnitTest 태스크를 실행하고
 * Paparazzi 스냅샷 PNG를 outDir로 복사한다.
 */
export async function runPaparazziTest(opts: RunnerOptions): Promise<RunnerResult> {
  const {
    workDir,
    snapshotDir,
    screenName,
    outDir,
    gradlePath,
    androidSdkPath,
    timeoutMs = 600_000,
    keepWorkDir = false,
  } = opts;

  try {
    // local.properties에 SDK 경로 주입
    if (androidSdkPath) {
      writeLocalProperties(workDir, androidSdkPath);
    }

    // Gradle 실행 파일 결정: gradlew > 시스템 gradle
    const gradleExec = resolveGradleExec(workDir, gradlePath);

    // testDebugUnitTest 실행 (Paparazzi 스냅샷 기록)
    await runGradleTask(workDir, gradleExec, "testDebugUnitTest", timeoutMs, androidSdkPath);

    // 스냅샷 PNG 탐색
    const pngPath = findSnapshotPng(workDir, screenName);
    if (!pngPath || !fs.existsSync(pngPath)) {
      throw new CompileCaptureError(
        "TEST_FAILED",
        `Paparazzi 스냅샷 PNG를 찾을 수 없음 (screen=${screenName})`,
        ""
      );
    }

    // outDir로 복사
    fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, `${screenName}.png`);
    fs.copyFileSync(pngPath, dest);

    const { width, height } = readPngSize(dest);
    return { pngPath: dest, width, height };
  } finally {
    if (!keepWorkDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // 정리 실패 무시
      }
    }
  }
}

function resolveGradleExec(workDir: string, gradlePath?: string): string {
  if (gradlePath) return gradlePath;

  const gradlew = path.join(workDir, "gradlew");
  if (fs.existsSync(gradlew)) return gradlew;

  const gradlewBat = path.join(workDir, "gradlew.bat");
  if (fs.existsSync(gradlewBat)) return gradlewBat;

  return "gradle"; // 시스템 gradle 폴백
}

async function runGradleTask(
  workDir: string,
  gradleExec: string,
  task: string,
  timeoutMs: number,
  androidSdkPath?: string
): Promise<void> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (androidSdkPath) {
    env.ANDROID_HOME = androidSdkPath;
    env.ANDROID_SDK_ROOT = androidSdkPath;
  }

  let result: Awaited<ReturnType<typeof execa>>;

  try {
    result = await execa(gradleExec, [task, "--no-daemon", "--stacktrace"], {
      cwd: workDir,
      timeout: timeoutMs,
      reject: false,
      env,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ETIMEDOUT") || msg.includes("timed out")) {
      throw new CompileCaptureError("TIMEOUT", "Gradle 실행 타임아웃", "");
    }
    throw new CompileCaptureError(
      "TEST_FAILED",
      `Gradle 실행 중 오류: ${msg}`,
      ""
    );
  }

  if (result.exitCode !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const err = classifyGradleError(result.exitCode ?? 1, stderr, stdout);
    throw err ?? new CompileCaptureError("TEST_FAILED", "Gradle 실패", stderr);
  }
}

/**
 * Paparazzi 스냅샷 PNG 파일을 탐색한다.
 *
 * Paparazzi 1.3.x 실제 출력 위치:
 *   app/build/reports/paparazzi/debug/images/<hash>.png
 *   runs/*.js 파일에서 파일명 매핑 확인 가능
 */
function findSnapshotPng(workDir: string, screenName: string): string | null {
  const reportDir = path.join(workDir, "app", "build", "reports", "paparazzi", "debug");

  // 1) runs/*.js 파일에서 testName 기반으로 이미지 파일 매핑 파싱
  const runsDir = path.join(reportDir, "runs");
  if (fs.existsSync(runsDir)) {
    const pngFromRuns = findPngFromRunsDir(runsDir, reportDir, screenName);
    if (pngFromRuns) return pngFromRuns;
  }

  // 2) images/ 디렉토리의 첫 번째 PNG (테스트 1개이므로 유일)
  const imagesDir = path.join(reportDir, "images");
  if (fs.existsSync(imagesDir)) {
    try {
      const pngs = fs.readdirSync(imagesDir).filter((f) => f.endsWith(".png"));
      if (pngs.length > 0) {
        return path.join(imagesDir, pngs[0]);
      }
    } catch {
      // ignore
    }
  }

  // 3) 전통적인 출력 경로 폴백
  const fallbackDirs = [
    path.join(workDir, "app", "build", "outputs", "paparazzi", "images"),
    path.join(workDir, "app", "build", "paparazzi", "images"),
  ];
  for (const dir of fallbackDirs) {
    if (fs.existsSync(dir)) {
      const found = findFileRecursive(dir, `${screenName}.png`);
      if (found) return found;
      // 해시 기반 첫 번째 PNG
      try {
        const pngs = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
        if (pngs.length > 0) return path.join(dir, pngs[0]);
      } catch { /* ignore */ }
    }
  }

  // 4) build 전체 재귀 탐색 (최후 수단)
  const buildDir = path.join(workDir, "app", "build");
  if (fs.existsSync(buildDir)) {
    return findFileRecursive(buildDir, `${screenName}.png`);
  }

  return null;
}

/**
 * Paparazzi runs/*.js 파일에서 screenName과 관련된 PNG 경로를 파싱한다.
 */
function findPngFromRunsDir(
  runsDir: string,
  reportBaseDir: string,
  screenName: string
): string | null {
  try {
    const jsFiles = fs.readdirSync(runsDir).filter((f) => f.endsWith(".js"));
    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(path.join(runsDir, jsFile), "utf-8");
      // testName에 screenName이 포함된 항목의 file 필드 추출
      const pattern = new RegExp(
        `"testName":\\s*"[^"]*${screenName}[^"]*"[^}]*"file":\\s*"([^"]+)"`,
        "s"
      );
      const match = content.match(pattern);
      if (match) {
        const relativePng = match[1];
        const absolutePng = path.join(reportBaseDir, relativePng);
        if (fs.existsSync(absolutePng)) return absolutePng;
      }
    }
  } catch {
    // ignore
  }
  return null;
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
