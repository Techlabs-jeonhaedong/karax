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
}

// ── AgentKind ─────────────────────────────────────────────────────────────

export type AgentKind = "claude" | "codex" | "gemini";

// ── E2E 결과 ──────────────────────────────────────────────────────────────

export type E2eOutcome = "pass" | "fail" | "error";

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
}

export interface E2eStep {
  index: number;
  description: string;
  status: "pass" | "fail" | "skip";
  screenshot?: string;
  note?: string;
}
