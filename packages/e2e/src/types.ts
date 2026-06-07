/**
 * @karax/e2e — 공유 타입 및 에러 코드
 */

// ── 에러 코드 ────────────────────────────────────────────────────────────

export const E2E_ERROR_CODES = {
  FRAMEWORK_NOT_DETECTED: "FRAMEWORK_NOT_DETECTED",
  SCENARIO_PARSE_ERROR: "SCENARIO_PARSE_ERROR",
  NO_DEVICE_AVAILABLE: "NO_DEVICE_AVAILABLE",
  EMULATOR_BOOT_TIMEOUT: "EMULATOR_BOOT_TIMEOUT",
  COCOAPODS_REQUIRED: "COCOAPODS_REQUIRED",
  BUILD_FAILED: "BUILD_FAILED",
  ARTIFACT_NOT_FOUND: "ARTIFACT_NOT_FOUND",
  INSTALL_FAILED: "INSTALL_FAILED",
  LAUNCH_FAILED: "LAUNCH_FAILED",
  AGENT_CLI_MISSING: "AGENT_CLI_MISSING",
  AGENT_OUTPUT_INVALID: "AGENT_OUTPUT_INVALID",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  /** uiautomator dump 실패 — 디바이스 없음 또는 dump 자체 오류 */
  DUMP_FAILED: "DUMP_FAILED",
  /** idb 미설치 또는 사용 불가 — iOS 입력 주입 불가 */
  IDB_UNAVAILABLE: "IDB_UNAVAILABLE",
} as const;

export type E2eErrorCode = keyof typeof E2E_ERROR_CODES;

export class E2eError extends Error {
  constructor(
    public readonly code: E2eErrorCode,
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = "E2eError";
  }
}

// ── 플랫폼 ────────────────────────────────────────────────────────────────

export type Platform = "android" | "ios";

// ── AppMapGenerator ────────────────────────────────────────────────────────

import type { AppMap } from "@karax/core";

/**
 * AppMap 생성기 함수 타입 — sdk에서 주입되며, e2e 패키지는 이 타입에만 의존한다.
 * e2e→sdk 순환 의존 없이 DI(의존성 주입)으로 AppMap 생성 기능을 사용할 수 있다.
 */
export type AppMapGenerator = (opts: {
  projectPath: string;
  framework: "flutter" | "react-native" | "android" | "ios";
  device: string;
  outDir: string;
}) => Promise<{ appMap: AppMap; writtenPaths: string[] }>;

// ── runE2eTest 옵션 ───────────────────────────────────────────────────────

export interface RunE2eTestOptions {
  projectPath: string;
  platform: Platform;
  scenarioPath?: string;
  agent?: AgentKind;
  apiKey?: string;
  deviceId?: string;
  outDir?: string;
  timeoutMs?: number;
  maxSteps?: number;
  keepBooted?: boolean;
  /**
   * AppMap 생성기 함수 — 지정 시 E2E 세션 시작 시 AppMap을 생성하고 프롬프트에 주입한다.
   * sdk의 runE2eTest 래퍼가 기본값으로 generateAppMap 어댑터를 주입한다.
   * 직접 @karax/e2e를 사용하는 경우 이 옵션을 직접 제공하거나 생략(AppMap 미생성)할 수 있다.
   */
  appMapGenerator?: AppMapGenerator;
  /**
   * M8: 크래시 감지 시 outcome을 fail로 강등할지 여부. 기본값 true.
   * false로 설정하면 크래시가 있어도 에이전트 outcome을 그대로 유지한다.
   */
  failOnCrash?: boolean;
  /**
   * M11: 이전 빌드 캐시를 재사용할지 여부. 기본값 false.
   * true이면 소스 핑거프린트가 일치하고 artifact가 fresh할 때 빌드를 스킵한다.
   * 불일치 시 자동 재빌드.
   */
  reuseBuild?: boolean;
  /**
   * M11: 빌드를 전혀 수행하지 않는다. 기본값 false.
   * true이면 캐시 히트 + fresh artifact가 있을 때만 진행. 없으면 ARTIFACT_NOT_FOUND 에러.
   */
  noBuild?: boolean;
  /**
   * M11: 시나리오의 permissions[]를 디바이스에 자동 grant할지 여부.
   * 기본값: 시나리오에 permissions 선언이 있으면 자동 true, 명시 false이면 끔.
   */
  grantPermissions?: boolean;
  /**
   * M11: 비디오 녹화 여부. 기본값 false.
   * true이면 앱 실행 후 screenrecord(Android) / simctl recordVideo(iOS)를 시작한다.
   * 녹화 실패는 비차단 — 테스트 결과에 영향 없음.
   */
  recordVideo?: boolean;
  /**
   * 디버그 모드 활성화 여부. 기본값 false.
   * true이면 sessionDir/debug/ 에 디버그 아티팩트(빌드 로그, 에이전트 invocation,
   * teardown 로그 등)를 기록한다. 모든 아티팩트는 redact 처리 후 저장된다.
   * 모든 디버그 출력은 stderr 전용이며 stdout 계약에 영향을 주지 않는다.
   * KARAX_DEBUG=1 환경변수로도 활성화할 수 있다.
   */
  debug?: boolean;
  /**
   * 사용자 정의 빌드 커맨드.
   * 지정 시 빌더 기본 커맨드 대신 shell=true로 이 커맨드를 projectPath에서 실행한다.
   * 예: "fvm flutter build apk --debug --flavor dev"
   * noBuild=true와 함께 오면 무시된다 (에러 아님).
   */
  buildCommand?: string;
}

// ── AgentKind ─────────────────────────────────────────────────────────────

export type AgentKind = "claude" | "codex" | "gemini";

// ── E2E 결과 ──────────────────────────────────────────────────────────────

/** M8: "partial" 추가 — 에이전트 비정상 종료 후 부분 복구된 결과 */
export type E2eOutcome = "pass" | "fail" | "error" | "partial";

export interface E2eTestResult {
  outcome: E2eOutcome;
  sessionDir: string;
  reportJsonPath: string;
  reportMdPath: string;
  screenshotsDir: string;
  summary: string;
  steps: E2eStep[];
  /** AppMap이 생성된 경우 디렉토리 경로. 소비자 참고용 (없으면 undefined). */
  appMapDir?: string;
  /** M7: 스크린샷 없는 non-skip 스텝 경고 목록 (결정론 후처리) */
  qualityWarnings?: string[];
  /** M7: exploratory 모드에서 에이전트가 기록한 anomaly findings */
  findings?: Array<{
    id: string;
    severity: "critical" | "major" | "minor";
    category: string;
    screenId?: string;
    description: string;
    evidence?: string;
    reproSteps?: string[];
  }>;
  /** M7: 에이전트가 방문한 화면 id 목록 (AppMap 있으면 교집합 필터 적용) */
  visitedScreens?: string[];
  /** M8: 감지된 크래시 이벤트 목록 */
  crashes?: Array<{
    type: "fatal-exception" | "anr" | "process-death" | "native-crash";
    timestamp?: string;
    excerpt: string;
    appId?: string;
  }>;
  /** M8: 커버리지 계산 결과 (AppMap 있을 때만) */
  coverage?: {
    totalScreens: number;
    visitedScreens: number;
    visitedScreenIds: string[];
    unvisitedScreenIds: string[];
    coverageRatio: number;
  };
  /** M11: 녹화 비디오 파일 경로 목록 (recordVideo=true일 때) */
  videos?: string[];
}

export interface E2eStep {
  index: number;
  description: string;
  status: "pass" | "fail" | "skip";
  screenshot?: string;
  note?: string;
  /** 기대 동작 (시나리오 expected 필드에서 매핑) */
  expected?: string;
  /** 실제 동작 */
  actual?: string;
  /** 이 스텝이 수행된 화면 id */
  screenId?: string;
}
