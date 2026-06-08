import path from "path";
import { execa } from "execa";
import { access } from "fs/promises";
import type {
  CompileBackend,
  CompileEnvironment,
  AdapterContext,
  ScreenSummary,
  CaptureOptions,
  CaptureResult,
} from "@karax/adapter-api";
import { CompileCaptureError } from "./errors.js";
import { generateHarness } from "./harness/generator.js";
import { runPaparazziTest } from "./runner.js";

export const BACKEND_ID = "android" as const;

// ── 환경 감지 ─────────────────────────────────────────────────────────────────

async function detectJava(): Promise<boolean> {
  try {
    const { stdout, stderr } = await execa("java", ["-version"]);
    const output = stdout || stderr;
    const match = output.match(/"(\d+)\.(\d+)/);
    if (!match) return false;
    const first = parseInt(match[1], 10);
    const second = parseInt(match[2], 10);
    const major = first === 1 ? second : first;
    return major >= 11;
  } catch {
    return false;
  }
}

async function detectGradle(): Promise<boolean> {
  try {
    const { stdout } = await execa("gradle", ["--version"]);
    return /Gradle\s+\d+/.test(stdout);
  } catch {
    return false;
  }
}

async function detectAndroidSdk(): Promise<string | null> {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    `${process.env.HOME ?? ""}/Library/Android/sdk`,
    `${process.env.HOME ?? ""}/Android/Sdk`,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 다음 후보로
    }
  }
  return null;
}

// ── CompileBackend 구현 ───────────────────────────────────────────────────────

export const androidPaparazziBackend: CompileBackend = {
  id: "android",

  async isAvailable(_env: CompileEnvironment): Promise<boolean> {
    const [java, gradle, sdk] = await Promise.all([
      detectJava(),
      detectGradle(),
      detectAndroidSdk(),
    ]);
    return java && gradle && sdk !== null;
  },

  async capture(
    ctx: AdapterContext,
    screen: ScreenSummary,
    opts: CaptureOptions
  ): Promise<CaptureResult> {
    const { projectPath } = ctx;
    const { outDir, device = "pixel-8", mockSeed = 42, keepWorkDir = false } = opts;

    // SDK 감지
    const sdkPath = await detectAndroidSdk();
    if (!sdkPath) {
      throw new CompileCaptureError(
        "SDK_MISSING",
        "Android SDK를 찾을 수 없습니다. ANDROID_HOME 환경변수를 설정하세요.",
        ""
      );
    }

    // 하니스 생성
    const harness = await generateHarness({
      projectPath,
      screen,
      device,
      mockSeed,
    });

    try {
      // Paparazzi 테스트 실행 + PNG 회수
      const result = await runPaparazziTest({
        workDir: harness.workDir,
        snapshotDir: harness.snapshotDir,
        screenName: harness.screenName,
        outDir: path.resolve(outDir),
        androidSdkPath: sdkPath,
        timeoutMs: 600_000,
        keepWorkDir,
      });

      return {
        screenId: screen.id,
        pngPath: result.pngPath,
        width: result.width,
        height: result.height,
        tierUsed: "compile",
        confidence: 0.95,
      };
    } catch (e) {
      // CompileCaptureError는 그대로 전달
      if (e instanceof CompileCaptureError) throw e;
      // 기타 에러
      const msg = e instanceof Error ? e.message : String(e);
      throw new CompileCaptureError("TEST_FAILED", `캡처 실패: ${msg}`, "");
    }
  },
};

// re-export
export { CompileCaptureError } from "./errors.js";
export { classifyGradleError } from "./errors.js";
export type { CompileErrorCode } from "./errors.js";
export { parseKotlinConstructorParams, generateKotlinMockArg } from "./harness/paramCodegen.js";
export type { KotlinParam } from "./harness/paramCodegen.js";
export {
  generateSettingsGradle,
  generateLibsVersionsToml,
  generateHarnessModuleBuildGradle,
  generatePaparazziTestKt,
  deviceConfigForProfile,
  generateHarness,
} from "./harness/generator.js";
