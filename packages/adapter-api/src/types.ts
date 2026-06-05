import type { IRDocument, NavigationGraph } from "@sfc/core";

// ── 공유 기본 타입 ──────────────────────────────────────────────

export type FrameworkId =
  | "flutter"
  | "react-native"
  | "ios"
  | "android";

export type DeviceProfileId =
  | "iphone-15"
  | "iphone-se"
  | "pixel-8"
  | "pixel-7"
  | "generic-tablet";

export type CaptureMode = "auto" | "compile" | "static";

// ── SourceRef ──────────────────────────────────────────────────

export interface SourceRef {
  file: string;
  line?: number;
  symbol?: string;
}

// ── ScreenSummary ──────────────────────────────────────────────

export interface ScreenSummary {
  id: string;
  title?: string;
  discovery: "route" | "candidate";
  confidence: number;
  sourceRef?: SourceRef;
}

// ── DetectResult ───────────────────────────────────────────────

export interface FrameworkEvidence {
  type: "file" | "dependency" | "heuristic";
  description: string;
}

export interface DetectResult {
  frameworks: Array<{
    id: FrameworkId;
    confidence: number;
    evidence: FrameworkEvidence[];
  }>;
}

// ── Adapter Context ─────────────────────────────────────────────

export interface AdapterContext {
  projectPath: string;
  framework?: FrameworkId;
  device?: DeviceProfileId;
  captureMode?: CaptureMode;
  maxInlineDepth?: number;
  mockSeed?: number;
  includeCandidates?: boolean;
}

// ── CaptureResult ───────────────────────────────────────────────

export type TierUsed = "compile" | "static";

export interface CaptureResult {
  screenId: string;
  pngPath: string;
  width: number;
  height: number;
  tierUsed: TierUsed;
  confidence: number;
}

// ── FrameworkAdapter 인터페이스 ─────────────────────────────────

export interface FrameworkAdapter {
  readonly id: FrameworkId;

  /**
   * 프로젝트 경로를 분석해 이 어댑터가 적용 가능한지 판단한다.
   */
  detect(projectPath: string): Promise<{
    matches: boolean;
    confidence: number;
    evidence: FrameworkEvidence[];
  }>;

  /**
   * 프로젝트에서 화면 목록을 정적 분석으로 발견한다.
   */
  discoverScreens(ctx: AdapterContext): Promise<ScreenSummary[]>;

  /**
   * 특정 화면의 UI IR을 정적 분석으로 빌드한다.
   */
  buildScreenIR(ctx: AdapterContext, screenId: string): Promise<IRDocument>;

  /**
   * 화면 간 네비게이션 그래프를 정적 분석으로 추출한다. (선택 구현)
   * 미구현 시 SDK가 빈 그래프 + NAV_UNSUPPORTED 진단을 생성한다.
   */
  discoverNavigation?(ctx: AdapterContext): Promise<NavigationGraph>;

  /**
   * 앱 이름을 추출한다. (선택 구현)
   * 미구현 시 SDK가 basename(projectPath) fallback을 사용한다.
   */
  readAppName?(ctx: AdapterContext): Promise<string | undefined>;
}

// ── CompileBackend 인터페이스 ───────────────────────────────────

export interface CompileEnvironment {
  /** 툴체인 실행파일 절대경로 (미감지 시 undefined) */
  toolchainPath?: string;
  /** 환경변수 등 추가 컨텍스트 */
  env?: Record<string, string>;
}

export interface CaptureOptions {
  outDir: string;
  device?: DeviceProfileId;
  mockSeed?: number;
}

export interface CompileBackend {
  readonly id: FrameworkId;

  /**
   * 현재 환경에서 이 백엔드를 사용할 수 있는지 확인한다.
   * false 반환 시 Tier 2 fallback이 자동으로 선택된다.
   */
  isAvailable(env: CompileEnvironment): Promise<boolean>;

  /**
   * 화면을 실제로 컴파일해서 PNG로 캡처한다.
   * 실패 시 throw — 호출자가 Tier 2 fallback을 처리한다.
   */
  capture(
    ctx: AdapterContext,
    screen: ScreenSummary,
    opts: CaptureOptions
  ): Promise<CaptureResult>;
}
