/**
 * @karax/sdk — 공개 API 조립 (PLAN.md 8절)
 *
 * 의존 패키지:
 *   @karax/core          — IR 스키마, Detector, captureEngine, confidence
 *   @karax/adapter-api   — FrameworkAdapter/CompileBackend 타입
 *   @karax/adapter-flutter
 *   @karax/compile-flutter
 *   @karax/renderer
 *   @karax/doctor
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
  DebugEvent,
} from "@karax/adapter-api";
export type { DebugEvent } from "@karax/adapter-api";
export { resetParserState } from "@karax/adapter-api";
import { detectFramework as coreDetectFramework } from "@karax/core";
import type { DetectResult } from "@karax/core";
import { computeProjectConfidence, expandVariants } from "@karax/core";
import { captureScreenWithTiers } from "@karax/core";
import { runDoctor, doctorFix as coreDoctorFix } from "@karax/doctor";
import type { DoctorReport } from "@karax/doctor";
import { renderScreenshot } from "@karax/renderer";
import type { IRDocument } from "@karax/core";
export { generateAppMap, renderAppMapMarkdown, writeAppMapDocuments } from "./appMap.js";
export type { GenerateAppMapOptions, GenerateAppMapResult, AppMap, AppMapDocument, AppMapRenderOptions } from "./appMap.js";

export const SDK_VERSION = "0.0.1" as const;

// ── E2E 테스트 (재노출) ────────────────────────────────────────────
// @karax/e2e의 public API를 sdk에서 재노출한다 (public API 집약점 관례).
// @karax/e2e는 무거운 디바이스/빌드 의존성을 가지므로 dynamic import로 lazy-load한다.
// 정적 import 시 SDK를 사용하는 호스트 프로세스의 시작 시간 증가 및 불필요한 모듈 로드를 방지한다.
export type { RunE2eTestOptions, E2eTestResult, Platform as E2ePlatform, AgentKind, E2eErrorCode } from "@karax/e2e";
export type { E2eError } from "@karax/e2e";
export type { RunE2eSuiteOptions, E2eSuiteResult } from "@karax/e2e";
export type { E2eProgressEvent, E2eProgressPhase, E2eProgressStatus, E2eProgressCallback } from "@karax/e2e";

/** appMapGenerator DI 어댑터 — sdk의 generateAppMap을 e2e에 주입한다 */
async function makeDefaultAppMapGenerator(): Promise<
  (opts: { projectPath: string; framework: string; device: string; outDir: string }) => Promise<{ appMap: import("@karax/core").AppMap; writtenPaths: string[] }>
> {
  return async (genOpts) => {
    const { generateAppMap } = await import("./appMap.js");
    const result = await generateAppMap({
      projectPath: genOpts.projectPath,
      framework: genOpts.framework as FrameworkId,
      device: genOpts.device,
      write: true,
      outDir: genOpts.outDir,
    });
    return { appMap: result.appMap, writtenPaths: result.writtenPaths };
  };
}

/**
 * E2E 테스트를 실행한다. (@karax/e2e를 lazy dynamic import로 로드)
 *
 * appMapGenerator가 미지정인 경우 sdk의 generateAppMap을 어댑터로 감싸 기본 주입한다.
 * 이를 통해 e2e→sdk 정적 순환 의존 없이 AppMap 생성 기능이 동작한다.
 *
 * debug 필드는 RunE2eTestOptions에 포함되어 있으며, spread(...opts)로 @karax/e2e에 자동 패스스루된다.
 */
export async function runE2eTest(
  opts: import("@karax/e2e").RunE2eTestOptions
): Promise<import("@karax/e2e").E2eTestResult> {
  const e2e = await import("@karax/e2e");

  const optsWithGenerator: import("@karax/e2e").RunE2eTestOptions = opts.appMapGenerator
    ? opts
    : { ...opts, appMapGenerator: await makeDefaultAppMapGenerator() };

  return e2e.runE2eTest(optsWithGenerator);
}

/**
 * 여러 시나리오를 일괄 실행한다. (@karax/e2e를 lazy dynamic import로 로드)
 *
 * scenarioPath가 파일이면 runE2eTest 1회, 디렉토리이면 *.md를 사전순으로 순차 실행.
 * appMapGenerator가 미지정인 경우 sdk의 generateAppMap을 어댑터로 기본 주입한다.
 *
 * debug 필드는 RunE2eSuiteOptions에 포함되어 있으며, spread(...opts)로 @karax/e2e에 자동 패스스루된다.
 */
export async function runE2eSuite(
  opts: import("@karax/e2e").RunE2eSuiteOptions
): Promise<import("@karax/e2e").E2eSuiteResult> {
  const e2e = await import("@karax/e2e");

  const optsWithGenerator: import("@karax/e2e").RunE2eSuiteOptions = opts.appMapGenerator
    ? opts
    : { ...opts, appMapGenerator: await makeDefaultAppMapGenerator() };

  return e2e.runE2eSuite(optsWithGenerator);
}

/**
 * E2E 에러 코드 맵을 반환한다. (@karax/e2e를 lazy dynamic import로 로드)
 */
export async function getE2eErrorCodes(): Promise<typeof import("@karax/e2e")["E2E_ERROR_CODES"]> {
  return (await import("@karax/e2e")).E2E_ERROR_CODES;
}

// ── 타입 re-export ─────────────────────────────────────────────────

export type { DetectResult, DoctorReport, ScreenSummary, CaptureResult, IRDocument };
export type { FrameworkId, DeviceProfileId, CaptureMode };

// ── EnrichmentPlugin 인터페이스 (enrich-llm 타입 의존 없이 직접 정의) ────
// @karax/enrich-llm의 EnrichmentPlugin과 구조적으로 호환된다.

export interface EnrichPatch {
  nodePath: string;
  replacement: IRDocument["screen"]["root"];
}

export interface EnrichDiagnostic {
  level: "info" | "warn" | "error";
  code: "ENRICHED" | "ENRICH_REJECTED";
  message: string;
  nodePath?: string;
}

export interface EnrichResult {
  patches: EnrichPatch[];
  diagnostics: EnrichDiagnostic[];
}

export interface EnrichmentPlugin {
  enrich(
    doc: IRDocument,
    targets: Array<{ nodePath: string; node: IRDocument["screen"]["root"] }>
  ): Promise<EnrichResult>;
}

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
      const m = await import("@karax/adapter-flutter");
      adapter = m.flutterAdapter;
      break;
    }
    case "react-native": {
      const m = await import("@karax/adapter-react-native");
      adapter = m.reactNativeAdapter;
      break;
    }
    case "android": {
      const m = await import("@karax/adapter-android");
      adapter = m.androidAdapter;
      break;
    }
    case "ios": {
      const m = await import("@karax/adapter-ios");
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
      const m = await import("@karax/compile-flutter");
      backend = m.flutterCompileBackend;
      break;
    }
    case "react-native": {
      const m = await import("@karax/compile-react-native");
      backend = m.rnWebCompileBackend;
      break;
    }
    case "android": {
      const m = await import("@karax/compile-android");
      backend = m.androidPaparazziBackend;
      break;
    }
    case "ios": {
      const m = await import("@karax/compile-ios");
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
 * KARAX_SKIP_ENSURE=1 환경변수로 비활성화 (테스트용).
 */
export async function ensureDependencies(): Promise<void> {
  if (process.env.KARAX_SKIP_ENSURE === "1") return;
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    const { doctorFix: fix } = await import("@karax/doctor");
    await fix();
  })().catch((err) => {
    // 실패 시 리셋해 다음 호출에서 재시도 가능하게 한다
    _ensurePromise = null;
    throw err;
  });

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
  /** LLM 보강 플러그인 — Tier 2 경로에서 IR 생성 후 적용 */
  enrich?: EnrichmentPlugin;
  /** 디버그 이벤트 수신 콜백. CLI가 주입하고 [karax/debug] 형태로 stderr에 출력. */
  onDebug?: (e: DebugEvent) => void;
  /** 디버그 모드 활성화 플래그. onDebug와 함께 사용. */
  debug?: boolean;
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
function makeRenderFn(device?: DeviceProfileId, debug?: boolean) {
  return async (
    ir: IRDocument,
    opts: { device?: string; outDir: string }
  ) => {
    return renderScreenshot(ir, {
      device: opts.device ?? device,
      outDir: opts.outDir,
      ...(debug ? { debug: true } : {}),
    });
  };
}

/**
 * enrich 플러그인이 있을 때 adapter.buildScreenIR 결과에 LLM 보강을 적용하는 래퍼.
 * captureEngine deps의 adapter를 교체하는 방식으로 주입한다.
 */
function makeEnrichAdapter(
  adapter: FrameworkAdapter,
  enrich: EnrichmentPlugin
): FrameworkAdapter {
  return {
    ...adapter,
    buildScreenIR: async (ctx, screenId) => {
      const doc = await adapter.buildScreenIR(ctx, screenId);

      // Unknown/저신뢰 노드를 수집해 enrich 대상으로 전달
      const targets = collectEnrichTargets(doc.screen.root);

      if (targets.length === 0) return doc;

      const result = await enrich.enrich(doc, targets);

      const enrichedDoc = applyEnrichPatches(doc, result.patches);

      // ENRICHED/ENRICH_REJECTED diagnostics를 사이드카에 추가
      const newDiags = result.diagnostics.map((d) => ({
        level: d.level,
        code: d.code,
        message: d.message,
        ...(d.nodePath ? { sourceRef: { file: doc.screen.sourceRef?.file ?? "", symbol: d.nodePath } } : {}),
      }));

      return {
        ...enrichedDoc,
        diagnostics: [...(enrichedDoc.diagnostics ?? []), ...newDiags],
      };
    },
  };
}

/**
 * EnrichPatch를 IRDocument에 적용한다.
 * enrich-llm의 applyPatches와 동일 로직 — @karax/enrich-llm 의존 없이 사용.
 */
function applyEnrichPatches(doc: IRDocument, patches: EnrichPatch[]): IRDocument {
  if (patches.length === 0) return doc;

  let current: IRDocument = JSON.parse(JSON.stringify(doc)) as IRDocument;

  for (const patch of patches) {
    current = applySingleEnrichPatch(current, patch);
  }

  return current;
}

function applySingleEnrichPatch(doc: IRDocument, patch: EnrichPatch): IRDocument {
  const segments = patch.nodePath.split(".").reduce<Array<string | number>>((acc, part) => {
    const m = part.match(/^(.+)\[(\d+)\]$/);
    if (m) {
      if (m[1]) acc.push(m[1]);
      acc.push(parseInt(m[2], 10));
    } else {
      acc.push(part);
    }
    return acc;
  }, []);

  if (segments[0] !== "root") return doc;

  const remaining = segments.slice(1);
  if (remaining.length === 0) {
    return { ...doc, screen: { ...doc.screen, root: patch.replacement } };
  }

  const newRoot = replaceAtEnrichPath(
    doc.screen.root as unknown as Record<string, unknown>,
    remaining,
    patch.replacement as unknown
  );

  if (!newRoot) return doc;

  return { ...doc, screen: { ...doc.screen, root: newRoot as unknown as IRDocument["screen"]["root"] } };
}

function replaceAtEnrichPath(
  obj: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown
): Record<string, unknown> | null {
  const [head, ...tail] = path;

  if (tail.length === 0) {
    if (typeof head === "string") return { ...obj, [head]: value };
    return null;
  }

  if (typeof head === "string") {
    const child = obj[head];

    if (Array.isArray(child)) {
      const [idx, ...rest] = tail;
      if (typeof idx !== "number" || idx < 0 || idx >= child.length) return null;
      const newArr = [...child];
      if (rest.length === 0) {
        newArr[idx] = value;
      } else {
        const replaced = replaceAtEnrichPath(child[idx] as Record<string, unknown>, rest, value);
        if (!replaced) return null;
        newArr[idx] = replaced;
      }
      return { ...obj, [head]: newArr };
    }

    if (child !== null && typeof child === "object") {
      const replaced = replaceAtEnrichPath(child as Record<string, unknown>, tail, value);
      if (!replaced) return null;
      return { ...obj, [head]: replaced };
    }
  }

  return null;
}

/** IR 트리에서 confidence < 0.5인 노드를 BFS로 수집 */
function collectEnrichTargets(
  root: IRDocument["screen"]["root"]
): Array<{ nodePath: string; node: typeof root }> {
  const targets: Array<{ nodePath: string; node: typeof root }> = [];
  const queue: Array<{ node: typeof root; path: string }> = [{ node: root, path: "root" }];

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;

    if (node.confidence < 0.5) {
      targets.push({ nodePath: path, node });
    }

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        queue.push({ node: node.children[i], path: `${path}.children[${i}]` });
      }
    }
  }

  return targets;
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
    onDebug: opts.onDebug,
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
    onDebug: opts.onDebug,
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
 *
 * variants?: boolean — true면 화면 내 Branch 분기별로 추가 PNG를 생성한다.
 *   생성 파일명: <screenId>__<variantLabel>.png (Tier 2 전용)
 * overlay?: "confidence" — confidence 오버레이 PNG를 추가 생성한다.
 *   생성 파일명: <screenId>__overlay.png
 */
export async function captureScreen(
  opts: AnalyzeOptions & {
    screenId: string;
    outDir?: string;
    variants?: boolean;
    overlay?: "confidence";
  }
): Promise<CaptureResult & { variantPngPaths?: string[]; overlayPngPath?: string }> {
  await ensureDependencies();

  const frameworkId = await resolveFrameworkId(opts);
  let adapter = await getAdapter(frameworkId);
  const compileBackend = await loadCompileBackend(frameworkId);

  // enrich 배선: adapter를 래핑
  if (opts.enrich) {
    adapter = makeEnrichAdapter(adapter, opts.enrich);
  }

  const ctx: AdapterContext = {
    projectPath: opts.projectPath,
    framework: frameworkId,
    device: opts.device,
    mockSeed: opts.mockSeed,
    maxInlineDepth: opts.maxInlineDepth,
    includeCandidates: true,
    onDebug: opts.onDebug,
  };

  // 대상 화면 찾기
  const screens = await adapter.discoverScreens(ctx);
  const screen = screens.find((s) => s.id === opts.screenId);
  if (!screen) {
    throw new Error(`화면 '${opts.screenId}'를 찾을 수 없습니다`);
  }

  const outDir = opts.outDir ?? process.env.KARAX_DEFAULT_OUT_DIR ?? "/tmp/karax-out";

  const engineResult = await captureScreenWithTiers(
    {
      adapter,
      compileBackend,
      renderScreenshot: makeRenderFn(opts.device, opts.debug),
    },
    {
      projectPath: opts.projectPath,
      screen,
      outDir,
      captureMode: opts.captureMode ?? "auto",
      device: opts.device ?? "iphone-15",
      mockSeed: opts.mockSeed ?? 0,
      onDebug: opts.onDebug,
      // debug=true 시 compile backend가 workDir을 보존한다
      keepWorkDir: opts.debug === true,
    }
  );

  const base: CaptureResult = {
    screenId: engineResult.screenId,
    pngPath: engineResult.pngPath,
    width: engineResult.width,
    height: engineResult.height,
    tierUsed: engineResult.tierUsed,
    confidence: engineResult.confidence,
  };

  // variants 옵션: Tier 2에서만 동작, Tier 1은 무시
  let variantPngPaths: string[] | undefined;
  if (opts.variants && engineResult.tierUsed === "static") {
    const ir = await adapter.buildScreenIR(ctx, opts.screenId);
    const variantDocs = expandVariants(ir);
    variantPngPaths = [];

    for (const { label, doc } of variantDocs) {
      const variantDoc = {
        ...doc,
        screen: { ...doc.screen, id: `${opts.screenId}__${label}` },
      };
      const result = await renderScreenshot(variantDoc, {
        device: opts.device ?? "iphone-15",
        outDir,
      });
      variantPngPaths.push(result.pngPath);
    }
  }

  // overlay 옵션
  let overlayPngPath: string | undefined;
  if (opts.overlay === "confidence") {
    const ir = await adapter.buildScreenIR(ctx, opts.screenId);
    const overlayResult = await renderScreenshot(ir, {
      device: opts.device ?? "iphone-15",
      outDir,
      overlay: "confidence",
    });
    overlayPngPath = overlayResult.overlayPngPath;
  }

  return {
    ...base,
    ...(variantPngPaths !== undefined ? { variantPngPaths } : {}),
    ...(overlayPngPath !== undefined ? { overlayPngPath } : {}),
  };
}

/**
 * 전체 화면을 캡처하고 AnalysisReport를 반환한다.
 *
 * variants?: boolean — Branch 분기별 추가 PNG 생성 (Tier 2 전용)
 * overlay?: "confidence" — 각 화면에 confidence 오버레이 PNG 추가 생성
 */
export async function captureAll(
  opts: AnalyzeOptions & {
    outDir: string;
    variants?: boolean;
    overlay?: "confidence";
  }
): Promise<{ screens: CaptureResult[]; report: AnalysisReport }> {
  if (!opts.outDir) {
    throw new Error("captureAll: outDir은 필수입니다");
  }

  await ensureDependencies();

  const frameworkId = await resolveFrameworkId(opts);
  let adapter = await getAdapter(frameworkId);
  const compileBackend = await loadCompileBackend(frameworkId);

  // enrich 배선
  if (opts.enrich) {
    adapter = makeEnrichAdapter(adapter, opts.enrich);
  }

  const ctx: AdapterContext = {
    projectPath: opts.projectPath,
    framework: frameworkId,
    device: opts.device,
    mockSeed: opts.mockSeed,
    includeCandidates: opts.includeCandidates ?? true,
    onDebug: opts.onDebug,
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
          renderScreenshot: makeRenderFn(opts.device, opts.debug),
        },
        {
          projectPath: opts.projectPath,
          screen,
          outDir: opts.outDir,
          captureMode: opts.captureMode ?? "auto",
          device: opts.device ?? "iphone-15",
          mockSeed: opts.mockSeed ?? 0,
          onDebug: opts.onDebug,
          // debug=true 시 compile backend가 workDir을 보존한다
          keepWorkDir: opts.debug === true,
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

      // variants: Tier 2에서만 Branch 분기별 추가 PNG 생성
      if (opts.variants && engineResult.tierUsed === "static") {
        try {
          const ir = await adapter.buildScreenIR(ctx, screen.id);
          const variantDocs = expandVariants(ir);
          for (const { label, doc } of variantDocs) {
            const variantDoc = {
              ...doc,
              screen: { ...doc.screen, id: `${screen.id}__${label}` },
            };
            await renderScreenshot(variantDoc, {
              device: opts.device ?? "iphone-15",
              outDir: opts.outDir,
            });
          }
        } catch (e) {
          // variant 생성 실패는 경고만, 전체 캡처 실패로 처리하지 않음
          extraLimitations.push(`${screen.id}: variant 생성 실패`);
          opts.onDebug?.({
            tag: "variant-failed",
            message: `${screen.id}: variant 생성 실패`,
            detail: e instanceof Error ? e.stack : String(e),
          });
        }
      }

      // overlay: 각 화면의 confidence 오버레이 PNG 생성
      if (opts.overlay === "confidence") {
        try {
          const ir = await adapter.buildScreenIR(ctx, screen.id);
          await renderScreenshot(ir, {
            device: opts.device ?? "iphone-15",
            outDir: opts.outDir,
            overlay: "confidence",
          });
        } catch (e) {
          extraLimitations.push(`${screen.id}: overlay 생성 실패`);
          opts.onDebug?.({
            tag: "overlay-failed",
            message: `${screen.id}: overlay 생성 실패`,
            detail: e instanceof Error ? e.stack : String(e),
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(screen.id);
      extraLimitations.push(`${screen.id}: 캡처 실패 — ${msg}`);
      opts.onDebug?.({
        tag: "capture-failed",
        message: `${screen.id}: 캡처 실패 — ${msg}`,
        detail: e instanceof Error ? e.stack : String(e),
      });
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
