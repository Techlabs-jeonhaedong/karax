import * as fs from "fs";
import * as path from "path";
import type { IRDocument } from "../ir/schema.js";

// ── 로컬 타입 (adapter-api 의존 없이 구조적 타이핑) ──────────────
// core는 @karax 내부 의존 0개를 유지해야 하므로
// adapter-api 타입을 직접 임포트하지 않고 구조적으로 재정의한다.

type DeviceProfileId = string;
type TierUsed = "compile" | "static";

interface LocalScreenSummary {
  id: string;
  title?: string;
  discovery: "route" | "candidate";
  confidence: number;
  sourceRef?: { file: string; line?: number; symbol?: string };
}

interface LocalCaptureOptions {
  outDir: string;
  device?: DeviceProfileId;
  mockSeed?: number;
}

interface LocalAdapterContext {
  projectPath: string;
  device?: DeviceProfileId;
  mockSeed?: number;
  includeCandidates?: boolean;
}

interface LocalCaptureResult {
  screenId: string;
  pngPath: string;
  width: number;
  height: number;
  tierUsed: TierUsed;
  confidence: number;
}

// ── 주입 가능한 의존 타입 ──────────────────────────────────────────

export interface CaptureEngineDeps {
  adapter: {
    buildScreenIR(ctx: LocalAdapterContext, screenId: string): Promise<IRDocument>;
  };
  compileBackend?: {
    isAvailable(env: Record<string, unknown>): Promise<boolean>;
    capture(
      ctx: LocalAdapterContext,
      screen: LocalScreenSummary,
      opts: LocalCaptureOptions
    ): Promise<LocalCaptureResult>;
  };
  renderScreenshot: (
    ir: IRDocument,
    opts: { device?: string; outDir: string }
  ) => Promise<{ pngPath: string; width: number; height: number }>;
}

export interface CaptureEngineOptions {
  projectPath: string;
  screen: LocalScreenSummary;
  outDir: string;
  captureMode?: "auto" | "compile" | "static";
  device?: DeviceProfileId;
  mockSeed?: number;
  /** ISO 8601 타임스탬프 반환 함수 (테스트 결정론) */
  clock?: () => string;
}

export interface CaptureEngineDiagnostic {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
}

export interface CaptureEngineResult {
  screenId: string;
  pngPath: string;
  width: number;
  height: number;
  tierUsed: TierUsed;
  confidence: number;
  diagnostics: CaptureEngineDiagnostic[];
}

// ── 내부 유틸 ─────────────────────────────────────────────────────

/**
 * 에러가 구조화된 CompileCaptureError인지 판단.
 * core는 compile-flutter에 의존하지 않으므로 이름/code 프로퍼티로 식별한다.
 */
function isCompileCaptureError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return (
    err["name"] === "CompileCaptureError" ||
    (typeof err["code"] === "string" &&
      ["PUB_GET_FAILED", "COMPILE_FAILED", "TEST_FAILED", "TIMEOUT", "UNINJECTABLE_PARAM"].includes(
        err["code"] as string
      ))
  );
}

/** 사이드카 report.json을 outDir/<screenId>_<device>.report.json에 작성한다.
 * PNG 파일명({screenId}_{device}.png)과 접미사를 통일해 덮어쓰기를 방지한다. */
function writeSidecarReport(
  screenId: string,
  device: string,
  outDir: string,
  report: object
): void {
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `${screenId}_${device}.report.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
}

// ── Tier 2 (static) 캡처 ─────────────────────────────────────────

async function captureStaticTier(
  deps: CaptureEngineDeps,
  opts: CaptureEngineOptions & { device: DeviceProfileId; mockSeed: number }
): Promise<{ pngPath: string; width: number; height: number; confidence: number }> {
  const { adapter, renderScreenshot } = deps;
  const { projectPath, screen, outDir, device, mockSeed } = opts;

  const adapterCtx: LocalAdapterContext = {
    projectPath,
    device,
    mockSeed,
    includeCandidates: true,
  };

  const ir = await adapter.buildScreenIR(adapterCtx, screen.id);
  const rendered = await renderScreenshot(ir, { device, outDir });

  return {
    pngPath: rendered.pngPath,
    width: rendered.width,
    height: rendered.height,
    confidence: ir.screen.confidence,
  };
}

// ── Tier 1 (compile) 캡처 ────────────────────────────────────────

async function captureCompileTier(
  deps: CaptureEngineDeps,
  opts: CaptureEngineOptions & { device: DeviceProfileId; mockSeed: number }
): Promise<{ pngPath: string; width: number; height: number; confidence: number }> {
  const { compileBackend } = deps;
  if (!compileBackend) {
    throw new Error("captureMode=compile 이지만 compileBackend가 제공되지 않았습니다");
  }

  const { screen, outDir, device, mockSeed, projectPath } = opts;
  const captureOpts: LocalCaptureOptions = { outDir, device, mockSeed };
  const ctx: LocalAdapterContext = { projectPath, device, mockSeed };

  const result = await compileBackend.capture(ctx, screen, captureOpts);

  return {
    pngPath: result.pngPath,
    width: result.width,
    height: result.height,
    confidence: result.confidence,
  };
}

// ── 메인 엔트리포인트 ─────────────────────────────────────────────

/**
 * 티어 선택 오케스트레이션.
 * captureMode에 따라 Tier 1/2를 선택하고, 사이드카 report.json을 작성한다.
 */
export async function captureScreenWithTiers(
  deps: CaptureEngineDeps,
  opts: CaptureEngineOptions
): Promise<CaptureEngineResult> {
  const {
    screen,
    outDir,
    captureMode = "auto",
    device = "iphone-15",
    mockSeed = 0,
    clock = () => new Date().toISOString(),
  } = opts;

  const fullOpts = { ...opts, device, mockSeed };
  const diagnostics: CaptureEngineDiagnostic[] = [];

  let pngPath: string;
  let width: number;
  let height: number;
  let tierUsed: TierUsed;
  let confidence: number;

  if (captureMode === "static") {
    // ── Tier 2 직행 ───────────────────────────────────────────────
    const r = await captureStaticTier(deps, fullOpts);
    ({ pngPath, width, height, confidence } = r);
    tierUsed = "static";
  } else if (captureMode === "compile") {
    // ── Tier 1 강제, 실패 시 에러 전파 ───────────────────────────
    const r = await captureCompileTier(deps, fullOpts);
    ({ pngPath, width, height, confidence } = r);
    tierUsed = "compile";
  } else {
    // ── auto: Tier 1 시도 → 실패/불가 시 Tier 2 fallback ─────────
    let usedTier2 = false;
    let fallbackReason = "";

    if (!deps.compileBackend) {
      usedTier2 = true;
      fallbackReason = "compileBackend 미제공";
    } else {
      const available = await deps.compileBackend.isAvailable({});
      if (!available) {
        usedTier2 = true;
        fallbackReason = "툴체인 미감지";
      } else {
        try {
          const r = await captureCompileTier(deps, fullOpts);
          ({ pngPath, width, height, confidence } = r);
          tierUsed = "compile";
        } catch (e) {
          if (isCompileCaptureError(e)) {
            usedTier2 = true;
            fallbackReason = (e as Error).message;
          } else {
            throw e;
          }
        }
      }
    }

    if (usedTier2) {
      diagnostics.push({
        level: "warn",
        code: "COMPILE_FALLBACK",
        message: `Tier 1 캡처 불가, Tier 2(static)로 fallback. 이유: ${fallbackReason}`,
      });
      const r = await captureStaticTier(deps, fullOpts);
      ({ pngPath, width, height, confidence } = r);
      tierUsed = "static";
    }
  }

  // ── 사이드카 report.json 작성 ─────────────────────────────────
  writeSidecarReport(screen.id, device, outDir, {
    screenId: screen.id,
    tierUsed: tierUsed!,
    confidence: confidence!,
    diagnostics,
    device,
    mockSeed,
    generatedAt: clock(),
  });

  return {
    screenId: screen.id,
    pngPath: pngPath!,
    width: width!,
    height: height!,
    tierUsed: tierUsed!,
    confidence: confidence!,
    diagnostics,
  };
}
