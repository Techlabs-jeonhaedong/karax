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
}

export interface E2eStep {
  index: number;
  description: string;
  status: "pass" | "fail" | "skip";
  screenshot?: string;
  note?: string;
}
