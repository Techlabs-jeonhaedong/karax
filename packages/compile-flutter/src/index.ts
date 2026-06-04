import * as path from "path";
import { execa } from "execa";
import type {
  CompileBackend,
  CompileEnvironment,
  AdapterContext,
  ScreenSummary,
  CaptureOptions,
  CaptureResult,
} from "@sfc/adapter-api";
import { generateHarness } from "./harness/generator.js";
import { runFlutterTest } from "./runner.js";
import { HarnessError } from "./harness/paramCodegen.js";
import { CompileCaptureError } from "./runner.js";

export const BACKEND_ID = "flutter" as const;

// ── flutter 경로 감지 ─────────────────────────────────────────────────────────

async function detectFlutterPath(env: CompileEnvironment): Promise<string | null> {
  // 명시적 경로 지정 시 우선 사용
  if (env.toolchainPath) {
    try {
      await execa(env.toolchainPath, ["--version"], { timeout: 10_000 });
      return env.toolchainPath;
    } catch {
      return null;
    }
  }

  // PATH에서 flutter 탐색 (콜드스타트가 느린 머신에서 20s+ 소요 가능 → 30s)
  try {
    const result = await execa("flutter", ["--version"], {
      timeout: 30_000,
      reject: false,
    });
    if (result.exitCode === 0) return "flutter";

    // 출력이 있으면 설치된 것으로 간주 (일부 버전은 stderr에 출력)
    const output = (result.stdout || result.stderr || "").toLowerCase();
    if (output.includes("flutter")) return "flutter";

    return null;
  } catch {
    return null;
  }
}

// ── CompileBackend 구현 ───────────────────────────────────────────────────────

export const flutterCompileBackend: CompileBackend = {
  id: "flutter",

  async isAvailable(env: CompileEnvironment): Promise<boolean> {
    const flutterPath = await detectFlutterPath(env);
    return flutterPath !== null;
  },

  async capture(
    ctx: AdapterContext,
    screen: ScreenSummary,
    opts: CaptureOptions
  ): Promise<CaptureResult> {
    const { projectPath } = ctx;
    const { outDir, device = "iphone-15", mockSeed = 0 } = opts;

    // flutter 경로 감지
    const flutterPath = await detectFlutterPath({});

    // 하니스 프로젝트 생성
    const harness = await generateHarness({
      projectPath,
      screen,
      device,
      mockSeed,
    });

    try {
      // flutter test 실행 + PNG 회수
      const result = await runFlutterTest({
        workDir: harness.workDir,
        goldenPath: harness.goldenPath,
        outDir: path.resolve(outDir),
        flutterPath: flutterPath ?? "flutter",
        timeoutMs: 180_000,
        keepWorkDir: false,
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
      // HarnessError → CompileCaptureError로 변환
      if (e instanceof HarnessError) {
        throw new CompileCaptureError(
          e.code as import("./runner.js").CompileErrorCode,
          e.message,
          ""
        );
      }
      throw e;
    }
  },
};

// re-export for consumers
export { CompileCaptureError } from "./runner.js";
export { HarnessError } from "./harness/paramCodegen.js";
export type { CompileErrorCode } from "./runner.js";
export type { ConstructorParam } from "./harness/paramCodegen.js";
