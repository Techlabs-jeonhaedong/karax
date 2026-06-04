/**
 * compile-react-native — Tier 1 백엔드
 *
 * esbuild + react-native-web alias + Playwright Chromium
 * Metro·네이티브 빌드 불필요.
 */
import * as path from "path";
import * as fs from "fs";
import type {
  CompileBackend,
  CompileEnvironment,
  AdapterContext,
  ScreenSummary,
  CaptureOptions,
  CaptureResult,
} from "@sfc/adapter-api";
import { generateHarness } from "./harness/generator.js";
import { runRnWebCapture, CompileCaptureError } from "./runner.js";

export { CompileCaptureError } from "./runner.js";
export type { CompileErrorCode } from "./runner.js";

export const BACKEND_ID = "react-native" as const;

// ── CompileBackend 구현 ───────────────────────────────────────────────────────

export const rnWebCompileBackend: CompileBackend = {
  id: "react-native",

  /**
   * esbuild는 이 패키지 dependencies에 내장되어 있으므로 항상 true.
   */
  async isAvailable(_env: CompileEnvironment): Promise<boolean> {
    return true;
  },

  async capture(
    ctx: AdapterContext,
    screen: ScreenSummary,
    opts: CaptureOptions
  ): Promise<CaptureResult> {
    const { projectPath } = ctx;
    const { outDir, device = "pixel-8", mockSeed = 42 } = opts;

    // 하니스 entry.jsx 생성
    let harness: { workDir: string; entryPath: string };
    try {
      harness = generateHarness({
        projectPath,
        screen,
        device,
        mockSeed,
      });
    } catch (e) {
      // generateHarness가 workDir을 생성한 뒤 throw할 수 있으므로 정리
      // workDir은 hash 기반 결정론적 경로이므로 직접 계산해 제거한다
      const { createHash } = await import("crypto");
      const hash = createHash("sha256")
        .update(`${projectPath}:${screen.id}:${device}:${mockSeed}`)
        .digest("hex")
        .slice(0, 12);
      const { join } = await import("path");
      const { tmpdir } = await import("os");
      const leakedDir = join(tmpdir(), `sfc-rn-${hash}`);
      try {
        fs.rmSync(leakedDir, { recursive: true, force: true });
      } catch {
        // 존재하지 않으면 무시
      }

      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("BUNDLE_FAILED:")) {
        throw new CompileCaptureError("BUNDLE_FAILED", msg, "");
      }
      throw new CompileCaptureError("BUNDLE_FAILED", `하니스 생성 실패: ${msg}`, "");
    }

    // 출력 PNG 경로
    fs.mkdirSync(outDir, { recursive: true });
    const pngFileName = `${screen.id}_${device}.png`;
    const outPath = path.join(path.resolve(outDir), pngFileName);

    try {
      const { width, height, mockedModules } = await runRnWebCapture({
        entryPath: harness.entryPath,
        projectPath,
        workDir: harness.workDir,
        outPath,
        device,
        timeoutMs: 30_000,
      });

      // mock된 모듈이 있으면 진단 정보를 콘솔에 기록
      if (mockedModules.length > 0) {
        const unique = [...new Set(mockedModules.map((m) => m.pkg))];
        console.warn(
          `[compile-react-native] ${screen.id}: ${unique.length}개 네이티브 모듈 mock됨: ${unique.join(", ")}`
        );
      }

      return {
        screenId: screen.id,
        pngPath: outPath,
        width,
        height,
        tierUsed: "compile",
        confidence: mockedModules.length > 0 ? 0.85 : 0.95,
      };
    } finally {
      // workDir 정리 (원본 무수정 원칙 — 임시 디렉토리만 정리)
      try {
        fs.rmSync(harness.workDir, { recursive: true, force: true });
      } catch {
        // 정리 실패 무시
      }
    }
  },
};
