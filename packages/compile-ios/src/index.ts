/**
 * compile-ios — iOS 시뮬레이터 스냅샷 Tier 1 컴파일 백엔드
 *
 * id: "ios-simulator-snapshot"
 * isAvailable: darwin + xcodebuild + simctl에 iOS 런타임 1개 이상
 */

import * as path from "path";
import type {
  CompileBackend,
  CompileEnvironment,
  AdapterContext,
  ScreenSummary,
  CaptureOptions,
  CaptureResult,
} from "@karax/adapter-api";
import { generateHarness } from "./harness/generator.js";
import {
  isXcodebuildAvailable,
  hasIosSimulatorRuntime,
  detectAvailableSimulator,
  runXcodebuildTest,
  CompileCaptureError,
} from "./runner.js";

export const BACKEND_ID = "ios" as const;

// ── CompileBackend 구현 ───────────────────────────────────────────────────────

export const iosSimulatorBackend: CompileBackend = {
  id: "ios",

  async isAvailable(_env: CompileEnvironment): Promise<boolean> {
    // macOS에서만 동작
    if (process.platform !== "darwin") return false;

    // xcodebuild 가용성 + simctl 가용성을 병렬로 확인 (순차 실행 시 30s+ → 병렬로 max(각각) 시간)
    const [xcode, hasSim] = await Promise.all([
      isXcodebuildAvailable(),
      hasIosSimulatorRuntime(),
    ]);
    return xcode && hasSim;
  },

  async capture(
    ctx: AdapterContext,
    screen: ScreenSummary,
    opts: CaptureOptions
  ): Promise<CaptureResult> {
    const { projectPath } = ctx;
    const { outDir, device = "iphone-15", mockSeed = 42, keepWorkDir = false } = opts;

    // 시뮬레이터 선택
    const simulator = await detectAvailableSimulator();
    if (!simulator) {
      throw new CompileCaptureError(
        "SIM_UNAVAILABLE",
        "사용 가능한 iOS 시뮬레이터를 찾을 수 없음. `xcrun simctl list devices available`를 확인하세요.",
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

    // xcodebuild test 실행
    const result = await runXcodebuildTest({
      workDir: harness.workDir,
      schemeName: harness.schemeName,
      outPath: harness.outPath,
      outDir: path.resolve(outDir),
      simulator,
      timeoutMs: 600_000,
      keepWorkDir,
    });

    return {
      screenId: screen.id,
      pngPath: result.pngPath,
      width: result.width,
      height: result.height,
      tierUsed: "compile",
      confidence: 0.92,
    };
  },
};

// re-exports
export { CompileCaptureError } from "./runner.js";
export type { CompileErrorCode } from "./runner.js";
export type { SimulatorInfo } from "./harness/generator.js";
