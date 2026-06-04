/**
 * @sfc/sdk — 공개 API 조립 (PLAN.md 8절)
 *
 * 의존 패키지:
 *   @sfc/core          — IR 스키마, Detector, captureEngine, confidence
 *   @sfc/adapter-api   — FrameworkAdapter/CompileBackend 타입
 *   @sfc/adapter-flutter
 *   @sfc/compile-flutter
 *   @sfc/renderer
 *   @sfc/doctor
 */

import type {
  FrameworkAdapter,
  CompileBackend,
  ScreenSummary,
  CaptureResult,
  AdapterContext,
  DeviceProfileId,
  FrameworkId,
  CaptureMode,
} from "@sfc/adapter-api";
import { detectFramework as coreDetectFramework } from "@sfc/core";
import type { DetectResult } from "@sfc/core";
import { computeProjectConfidence } from "@sfc/core";
import { captureScreenWithTiers } from "@sfc/core";
import { runDoctor, doctorFix as coreDoctorFix } from "@sfc/doctor";
import type { DoctorReport } from "@sfc/doctor";
import { flutterAdapter } from "@sfc/adapter-flutter";
import { flutterCompileBackend } from "@sfc/compile-flutter";
import { renderScreenshot } from "@sfc/renderer";
import type { IRDocument } from "@sfc/core";

export const SDK_VERSION = "0.0.1" as const;

// ── 타입 re-export ─────────────────────────────────────────────────

export type { DetectResult, DoctorReport, ScreenSummary, CaptureResult, IRDocument };
export type { FrameworkId, DeviceProfileId, CaptureMode };

// ── 어댑터/백엔드 레지스트리 ──────────────────────────────────────
// M6~M8에서 어댑터 추가는 이 두 레지스트리에 한 줄씩 추가

const ADAPTER_REGISTRY: Partial<Record<FrameworkId, FrameworkAdapter>> = {
  flutter: flutterAdapter,
};

const COMPILE_BACKEND_REGISTRY: Partial<Record<FrameworkId, CompileBackend>> = {
  flutter: flutterCompileBackend,
};

// M6~M8 구현 전까지 미지원 프레임워크 목록
const UNSUPPORTED_FRAMEWORKS: FrameworkId[] = ["react-native", "ios", "android"];

// ── ensureDependencies ────────────────────────────────────────────

let _ensurePromise: Promise<void> | null = null;

/**
 * Chromium 등 자동 설치 가능한 의존성을 1회만 설치한다.
 * SFC_SKIP_ENSURE=1 환경변수로 비활성화 (테스트용).
 */
export async function ensureDependencies(): Promise<void> {
  if (process.env.SFC_SKIP_ENSURE === "1") return;
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    const { doctorFix: fix } = await import("@sfc/doctor");
    await fix();
  })();

  return _ensurePromise;
}

// ── AnalyzeOptions ─────────────────────────────────────────────────

export interface AnalyzeOptions {
  projectPath: string;
  framework?: FrameworkId;
  device?: DeviceProfileId;
  captureMode?: CaptureMode;
  maxInlineDepth?: number;
  mockSeed?: number;
  includeCandidates?: boolean;
  enrich?: unknown; // EnrichmentPlugin — M9에서 구체화
}

// ── AnalysisReport ─────────────────────────────────────────────────

export interface AnalysisReport {
  screens: CaptureResult[];
  overallConfidence: number;
  /** 상시 고지 문구 — Tier 2 한계 등 항상 포함 (실제 실패 여부와 무관) */
  limitations: string[];
  /** 실제 캡처에 실패한 화면 ID 목록 — CLI exit 2 판단에 사용 */
  failures: string[];
}

// ── 내부 유틸 ─────────────────────────────────────────────────────

/** framework를 결정한다. 미지정 시 detectFramework 1순위 후보 사용. */
async function resolveFrameworkId(
  opts: AnalyzeOptions
): Promise<FrameworkId> {
  if (opts.framework) {
    return opts.framework;
  }

  const detected = await coreDetectFramework(opts.projectPath);
  if (detected.frameworks.length === 0) {
    throw Object.assign(
      new Error(
        "프레임워크를 감지할 수 없습니다. framework 옵션으로 명시하거나, 지원되는 프레임워크 프로젝트인지 확인하세요."
      ),
      { code: "FRAMEWORK_NOT_DETECTED" }
    );
  }

  return detected.frameworks[0].id;
}

/** 어댑터를 가져온다. 미지원 시 UNSUPPORTED_FRAMEWORK 에러. */
function getAdapter(frameworkId: FrameworkId): FrameworkAdapter {
  if (UNSUPPORTED_FRAMEWORKS.includes(frameworkId)) {
    throw Object.assign(
      new Error(
        `UNSUPPORTED_FRAMEWORK: '${frameworkId}' 어댑터는 아직 구현되지 않았습니다. ` +
          `M6(react-native)/M7(android)/M8(ios) 마일스톤에서 해제됩니다.`
      ),
      { code: "UNSUPPORTED_FRAMEWORK" }
    );
  }

  const adapter = ADAPTER_REGISTRY[frameworkId];
  if (!adapter) {
    throw Object.assign(
      new Error(
        `UNSUPPORTED_FRAMEWORK: '${frameworkId}' 어댑터가 레지스트리에 없습니다.`
      ),
      { code: "UNSUPPORTED_FRAMEWORK" }
    );
  }

  return adapter;
}

/** renderScreenshot을 captureEngine deps 형식으로 래핑 */
function makeRenderFn(device?: DeviceProfileId) {
  return async (
    ir: IRDocument,
    opts: { device?: string; outDir: string }
  ) => {
    return renderScreenshot(ir, {
      device: opts.device ?? device,
      outDir: opts.outDir,
    });
  };
}

// ── 공개 API ──────────────────────────────────────────────────────

/**
 * 프로젝트의 프레임워크를 감지한다.
 */
export async function detectFramework(projectPath: string): Promise<DetectResult> {
  return coreDetectFramework(projectPath);
}

/**
 * 환경 진단 리포트를 반환한다.
 */
export async function doctor(projectPath?: string): Promise<DoctorReport> {
  return runDoctor(projectPath);
}

/**
 * 설치 가능한 의존성을 자동 설치 후 재진단한다.
 */
export async function doctorFix(report?: DoctorReport): Promise<DoctorReport> {
  return coreDoctorFix(report);
}

/**
 * 프로젝트에서 화면 목록을 정적 분석으로 발견한다.
 */
export async function listScreens(opts: AnalyzeOptions): Promise<ScreenSummary[]> {
  const frameworkId = await resolveFrameworkId(opts);
  const adapter = getAdapter(frameworkId);

  const ctx: AdapterContext = {
    projectPath: opts.projectPath,
    framework: frameworkId,
    device: opts.device,
    captureMode: opts.captureMode,
    maxInlineDepth: opts.maxInlineDepth,
    mockSeed: opts.mockSeed,
    includeCandidates: opts.includeCandidates ?? true,
  };

  return adapter.discoverScreens(ctx);
}

/**
 * 특정 화면(또는 전체)의 UI IR을 정적 분석으로 반환한다.
 */
export async function buildScreenIR(
  opts: AnalyzeOptions & { screenId?: string }
): Promise<IRDocument[]> {
  const frameworkId = await resolveFrameworkId(opts);
  const adapter = getAdapter(frameworkId);

  const ctx: AdapterContext = {
    projectPath: opts.projectPath,
    framework: frameworkId,
    device: opts.device,
    captureMode: opts.captureMode,
    maxInlineDepth: opts.maxInlineDepth,
    mockSeed: opts.mockSeed,
    includeCandidates: opts.includeCandidates ?? true,
  };

  if (opts.screenId) {
    const doc = await adapter.buildScreenIR(ctx, opts.screenId);
    return [doc];
  }

  // screenId 미지정: 전체 화면 IR 반환
  const screens = await adapter.discoverScreens(ctx);
  const docs: IRDocument[] = [];
  for (const screen of screens) {
    const doc = await adapter.buildScreenIR(ctx, screen.id);
    docs.push(doc);
  }
  return docs;
}

/**
 * 특정 화면을 캡처한다.
 */
export async function captureScreen(
  opts: AnalyzeOptions & { screenId: string; outDir?: string }
): Promise<CaptureResult> {
  await ensureDependencies();

  const frameworkId = await resolveFrameworkId(opts);
  const adapter = getAdapter(frameworkId);
  const compileBackend = COMPILE_BACKEND_REGISTRY[frameworkId];

  const ctx: AdapterContext = {
    projectPath: opts.projectPath,
    framework: frameworkId,
    device: opts.device,
    mockSeed: opts.mockSeed,
    includeCandidates: true,
  };

  // 대상 화면 찾기
  const screens = await adapter.discoverScreens(ctx);
  const screen = screens.find((s) => s.id === opts.screenId);
  if (!screen) {
    throw new Error(`화면 '${opts.screenId}'를 찾을 수 없습니다`);
  }

  const outDir = opts.outDir ?? process.env.SFC_DEFAULT_OUT_DIR ?? "/tmp/sfc-out";

  const engineResult = await captureScreenWithTiers(
    {
      adapter,
      compileBackend,
      renderScreenshot: makeRenderFn(opts.device),
    },
    {
      projectPath: opts.projectPath,
      screen,
      outDir,
      captureMode: opts.captureMode ?? "auto",
      device: opts.device ?? "iphone-15",
      mockSeed: opts.mockSeed ?? 0,
    }
  );

  return {
    screenId: engineResult.screenId,
    pngPath: engineResult.pngPath,
    width: engineResult.width,
    height: engineResult.height,
    tierUsed: engineResult.tierUsed,
    confidence: engineResult.confidence,
  };
}

/**
 * 전체 화면을 캡처하고 AnalysisReport를 반환한다.
 */
export async function captureAll(
  opts: AnalyzeOptions & { outDir: string }
): Promise<{ screens: CaptureResult[]; report: AnalysisReport }> {
  if (!opts.outDir) {
    throw new Error("captureAll: outDir은 필수입니다");
  }

  await ensureDependencies();

  const frameworkId = await resolveFrameworkId(opts);
  const adapter = getAdapter(frameworkId);
  const compileBackend = COMPILE_BACKEND_REGISTRY[frameworkId];

  const ctx: AdapterContext = {
    projectPath: opts.projectPath,
    framework: frameworkId,
    device: opts.device,
    mockSeed: opts.mockSeed,
    includeCandidates: opts.includeCandidates ?? true,
  };

  const screens = await adapter.discoverScreens(ctx);
  const capturedScreens: CaptureResult[] = [];
  /** 실제 캡처 실패한 화면 ID 목록 (CLI exit 2 판단에 사용) */
  const failures: string[] = [];
  /** COMPILE_FALLBACK 등 부가 정보 — limitations에 추가 */
  const extraLimitations: string[] = [];

  for (const screen of screens) {
    try {
      const engineResult = await captureScreenWithTiers(
        {
          adapter,
          compileBackend,
          renderScreenshot: makeRenderFn(opts.device),
        },
        {
          projectPath: opts.projectPath,
          screen,
          outDir: opts.outDir,
          captureMode: opts.captureMode ?? "auto",
          device: opts.device ?? "iphone-15",
          mockSeed: opts.mockSeed ?? 0,
        }
      );

      capturedScreens.push({
        screenId: engineResult.screenId,
        pngPath: engineResult.pngPath,
        width: engineResult.width,
        height: engineResult.height,
        tierUsed: engineResult.tierUsed,
        confidence: engineResult.confidence,
      });

      // COMPILE_FALLBACK은 실패가 아닌 부가 정보로 기록
      for (const diag of engineResult.diagnostics) {
        if (diag.code === "COMPILE_FALLBACK") {
          extraLimitations.push(`${screen.id}: ${diag.message}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(screen.id);
      extraLimitations.push(`${screen.id}: 캡처 실패 — ${msg}`);
    }
  }

  // overallConfidence: computeProjectConfidence 활용
  const projectConf = computeProjectConfidence(
    capturedScreens.map((s) => ({ confidence: s.confidence }))
  );

  // PLAN 12절: Tier 2 한계 고정 문구는 항상 포함 (static 모드에서도 비어있지 않아야 함)
  const tier2Limitations = [
    "Tier 2는 픽셀 퍼펙트가 아닌 구조적 근사입니다",
    "동적 데이터, 차트, 지도, 애니메이션은 placeholder/근사 처리됩니다",
    "코드 생성(build_runner 등) 의존 UI는 누락될 수 있습니다",
  ];

  const report: AnalysisReport = {
    screens: capturedScreens,
    overallConfidence: projectConf.average,
    limitations: [...tier2Limitations, ...extraLimitations],
    failures,
  };

  return { screens: capturedScreens, report };
}
