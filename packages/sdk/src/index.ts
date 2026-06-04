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
import { renderScreenshot } from "@sfc/renderer";
import type { IRDocument } from "@sfc/core";

export const SDK_VERSION = "0.0.1" as const;

// ── 타입 re-export ─────────────────────────────────────────────────

export type { DetectResult, DoctorReport, ScreenSummary, CaptureResult, IRDocument };
export type { FrameworkId, DeviceProfileId, CaptureMode };

// ── 어댑터/백엔드 lazy 로더 ───────────────────────────────────────
//
// 어댑터들은 tree-sitter WASM을 포함하는 패키지를 의존하므로,
// 정적 import 시 WASM JIT 컴파일이 모든 패키지에 대해 동시에 발생해
// V8 Zone OOM이 유발된다. dynamic import로 필요한 시점에만 로드한다.
//
// ⚠️  V8 WASM-JIT Zone OOM 주의 (Node v22+ + swift/kotlin tree-sitter WASM):
//   SDK를 라이브러리로 직접 사용하는 호스트 프로세스에서 iOS fixture 대상으로
//   captureAll/captureScreen을 실행하면 "Fatal process out of memory: Zone
//   (Turboshaft WASM 컴파일)" 크래시가 발생할 수 있습니다.
//   완화 방법:
//     1. Node 실행 시 --liftoff-only 플래그 사용 (WASM baseline JIT만 사용):
//        node --liftoff-only your-script.js
//     2. vitest 등 테스트 러너의 worker 격리 환경 사용
//     3. --max-old-space-size는 이 OOM에 효과 없음 (Turboshaft Zone은 별도 할당)
//   CLI/MCP 서버는 내부적으로 격리된 프로세스로 실행되므로 영향 없음.

const _adapterCache: Partial<Record<FrameworkId, FrameworkAdapter>> = {};
const _backendCache: Partial<Record<FrameworkId, CompileBackend>> = {};

async function loadAdapter(id: FrameworkId): Promise<FrameworkAdapter> {
  if (_adapterCache[id]) return _adapterCache[id]!;

  let adapter: FrameworkAdapter;
  switch (id) {
    case "flutter": {
      const m = await import("@sfc/adapter-flutter");
      adapter = m.flutterAdapter;
      break;
    }
    case "react-native": {
      const m = await import("@sfc/adapter-react-native");
      adapter = m.reactNativeAdapter;
      break;
    }
    case "android": {
      const m = await import("@sfc/adapter-android");
      adapter = m.androidAdapter;
      break;
    }
    case "ios": {
      const m = await import("@sfc/adapter-ios");
      adapter = m.iosAdapter;
      break;
    }
    default:
      throw Object.assign(
        new Error(`UNSUPPORTED_FRAMEWORK: '${id}' 어댑터가 없습니다.`),
        { code: "UNSUPPORTED_FRAMEWORK" }
      );
  }

  _adapterCache[id] = adapter;
  return adapter;
}

async function loadCompileBackend(id: FrameworkId): Promise<CompileBackend | undefined> {
  if (id in _backendCache) return _backendCache[id];

  let backend: CompileBackend | undefined;
  switch (id) {
    case "flutter": {
      const m = await import("@sfc/compile-flutter");
      backend = m.flutterCompileBackend;
      break;
    }
    case "react-native": {
      const m = await import("@sfc/compile-react-native");
      backend = m.rnWebCompileBackend;
      break;
    }
    case "android": {
      const m = await import("@sfc/compile-android");
      backend = m.androidPaparazziBackend;
      break;
    }
    case "ios": {
      const m = await import("@sfc/compile-ios");
      backend = m.iosSimulatorBackend;
      break;
    }
    default:
      backend = undefined;
  }

  _backendCache[id] = backend;
  return backend;
}

// 모든 프레임워크가 등록됨 — 미지원 목록 없음
const UNSUPPORTED_FRAMEWORKS: FrameworkId[] = [];

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

/** 어댑터를 가져온다 (lazy dynamic import). 미지원 시 UNSUPPORTED_FRAMEWORK 에러. */
async function getAdapter(frameworkId: FrameworkId): Promise<FrameworkAdapter> {
  if (UNSUPPORTED_FRAMEWORKS.includes(frameworkId)) {
    throw Object.assign(
      new Error(
        `UNSUPPORTED_FRAMEWORK: '${frameworkId}' 어댑터는 아직 구현되지 않았습니다.`
      ),
      { code: "UNSUPPORTED_FRAMEWORK" }
    );
  }
  return loadAdapter(frameworkId);
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
  const adapter = await getAdapter(frameworkId);

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
  const adapter = await getAdapter(frameworkId);

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
  const adapter = await getAdapter(frameworkId);
  const compileBackend = await loadCompileBackend(frameworkId);

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
  const adapter = await getAdapter(frameworkId);
  const compileBackend = await loadCompileBackend(frameworkId);

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
