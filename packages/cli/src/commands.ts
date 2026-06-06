/**
 * CLI 커맨드 파서 — commander 기반
 *
 * 각 parse* 함수는 commander를 사용해 argv 배열을 파싱하고
 * 결과 옵션 객체를 반환한다. bin.ts가 이 함수들을 사용한다.
 */

import { Command } from "commander";
import type { CaptureMode } from "@karax/sdk";

// ── 종료 코드 ──────────────────────────────────────────────────────

export const EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
  PARTIAL_FAILURE: 2,
} as const;

// ── 파서 유틸 ─────────────────────────────────────────────────────

/**
 * 프로그램을 만들고 parseOptions에서 에러 발생 시 throw하도록 구성한다.
 * (commander 기본은 process.exit(1)이므로 테스트에서 catch 불가)
 */
function makeProgram(name: string): Command {
  const prog = new Command(name);
  prog.exitOverride(); // process.exit 대신 throw CommanderError
  return prog;
}

// ── detect ────────────────────────────────────────────────────────

export interface DetectArgs {
  path: string;
}

export function parseDetectArgs(argv: string[]): DetectArgs {
  const prog = makeProgram("detect");
  prog.argument("<path>", "프로젝트 경로");
  prog.parse(["node", "detect", ...argv]);
  return { path: prog.args[0] };
}

// ── doctor ────────────────────────────────────────────────────────

export interface DoctorArgs {
  path?: string;
  fix: boolean;
}

export function parseDoctorArgs(argv: string[]): DoctorArgs {
  const prog = makeProgram("doctor");
  prog.argument("[path]", "프로젝트 경로 (옵셔널)");
  prog.option("--fix", "설치 가능한 의존성을 자동 설치", false);
  prog.parse(["node", "doctor", ...argv]);

  return {
    path: prog.args[0],
    fix: prog.opts<{ fix: boolean }>().fix,
  };
}

// ── list ──────────────────────────────────────────────────────────

export interface ListArgs {
  path: string;
  includeCandidates: boolean;
  json: boolean;
}

export function parseListArgs(argv: string[]): ListArgs {
  const prog = makeProgram("list");
  prog.argument("<path>", "프로젝트 경로");
  prog.option("--include-candidates", "라우트 미연결 후보 화면 포함 (기본 on)");
  prog.option("--no-candidates", "후보 화면 제외");
  prog.option("--json", "JSON 형식으로 출력", false);
  prog.parse(["node", "list", ...argv]);

  const opts = prog.opts<{ candidates?: boolean; includeCandidates?: boolean; json: boolean }>();
  // --no-candidates → opts.candidates = false
  // --include-candidates → opts.includeCandidates = true
  // 아무것도 없으면 → 기본 true
  let includeCandidates = true;
  if (opts.candidates === false) {
    includeCandidates = false;
  } else if (opts.includeCandidates === true) {
    includeCandidates = true;
  }

  return {
    path: prog.args[0],
    includeCandidates,
    json: opts.json,
  };
}

// ── capture ───────────────────────────────────────────────────────

export interface CaptureArgs {
  path: string;
  screen?: string;
  device?: string;
  mode: CaptureMode;
  out?: string;
  seed?: number;
  json: boolean;
  /** Branch 분기별 variant PNG 추가 생성 (Tier 2 전용) */
  variants: boolean;
  /** confidence 오버레이 PNG 추가 생성 */
  overlay: boolean;
}

const VALID_MODES: CaptureMode[] = ["auto", "compile", "static"];

export function parseCaptureArgs(argv: string[]): CaptureArgs {
  const prog = makeProgram("capture");
  prog.argument("<path>", "프로젝트 경로");
  prog.option("--screen <id>", "캡처할 화면 ID (없으면 전체)");
  prog.option("--device <id>", "디바이스 프로파일 ID");
  prog.option("--mode <mode>", "캡처 모드: auto|compile|static", "auto");
  prog.option("--out <dir>", "출력 디렉토리");
  prog.option("--seed <n>", "mock 결정론 시드 (숫자)");
  prog.option("--json", "JSON 형식으로 출력", false);
  prog.option("--variants", "Branch 분기별 variant PNG 추가 생성 (Tier 2 전용)", false);
  prog.option("--overlay", "confidence < 0.5 노드 하이라이트 오버레이 PNG 생성", false);
  prog.parse(["node", "capture", ...argv]);

  const opts = prog.opts<{
    screen?: string;
    device?: string;
    mode: string;
    out?: string;
    seed?: string;
    json: boolean;
    variants: boolean;
    overlay: boolean;
  }>();

  if (!VALID_MODES.includes(opts.mode as CaptureMode)) {
    throw new Error(
      `잘못된 --mode 값: '${opts.mode}'. 허용: auto, compile, static`
    );
  }

  const seed = opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined;

  return {
    path: prog.args[0],
    screen: opts.screen,
    device: opts.device,
    mode: opts.mode as CaptureMode,
    out: opts.out,
    seed,
    json: opts.json,
    variants: opts.variants,
    overlay: opts.overlay,
  };
}

// ── map ───────────────────────────────────────────────────────────

const VALID_FRAMEWORK_IDS = ["flutter", "react-native", "android", "ios"] as const;
type ValidFrameworkId = (typeof VALID_FRAMEWORK_IDS)[number];

export interface MapArgs {
  path: string;
  out?: string;
  maxChars?: number;
  json: boolean;
  /** 정적 좌표 측정 활성화 여부 (기본 true, --no-layout으로 비활성화) */
  layout: boolean;
  /** 프레임워크 강제 지정 */
  framework?: ValidFrameworkId;
  /** 파일 저장 없이 렌더된 마크다운을 stdout으로 출력 */
  stdout: boolean;
}

export function parseMapArgs(argv: string[]): MapArgs {
  const prog = makeProgram("map");
  prog.argument("<path>", "분석할 프로젝트 경로");
  prog.option("--out <dir>", "마크다운 파일 출력 디렉토리");
  prog.option("--max-chars <n>", "문서 분할 기준 최대 글자 수");
  prog.option("--json", "JSON 형식으로 AppMap 출력", false);
  prog.option("--no-layout", "정적 좌표 측정 비활성화 (Chromium 미사용)");
  prog.option(
    "--framework <id>",
    `프레임워크 강제 지정: ${VALID_FRAMEWORK_IDS.join("|")}`
  );
  prog.option("--stdout", "파일 저장 없이 마크다운을 stdout으로 출력", false);
  prog.parse(["node", "map", ...argv]);

  const opts = prog.opts<{
    out?: string;
    maxChars?: string;
    json: boolean;
    layout: boolean;
    framework?: string;
    stdout: boolean;
  }>();

  // --stdout과 --out 동시 지정 금지
  if (opts.stdout && opts.out !== undefined) {
    throw new Error("--stdout과 --out은 동시에 지정할 수 없습니다. 하나만 선택하세요.");
  }

  let maxChars: number | undefined;
  if (opts.maxChars !== undefined) {
    const parsed = parseInt(opts.maxChars, 10);
    if (isNaN(parsed) || parsed < 500) {
      throw new Error(`--max-chars는 500 이상이어야 합니다 (입력값: ${opts.maxChars})`);
    }
    maxChars = parsed;
  }

  let framework: ValidFrameworkId | undefined;
  if (opts.framework !== undefined) {
    if (!(VALID_FRAMEWORK_IDS as readonly string[]).includes(opts.framework)) {
      throw new Error(
        `잘못된 --framework 값: '${opts.framework}'. 허용: ${VALID_FRAMEWORK_IDS.join(", ")}`
      );
    }
    framework = opts.framework as ValidFrameworkId;
  }

  return {
    path: prog.args[0],
    out: opts.out,
    maxChars,
    json: opts.json,
    layout: opts.layout,
    framework,
    stdout: opts.stdout,
  };
}

// ── mcp-config ────────────────────────────────────────────────────

export interface McpConfigArgs {
  // 현재는 옵션 없음
}

export function parseMcpConfigArgs(_argv: string[]): McpConfigArgs {
  return {};
}

// ── test ─────────────────────────────────────────────────────────────────

export type TestPlatform = "android" | "ios";
export type TestAgent = "claude" | "codex" | "gemini";

export interface TestArgs {
  path: string;
  platform: TestPlatform;
  scenario?: string;
  agent: TestAgent;
  apiKey?: string;
  device?: string;
  out?: string;
  timeout?: number;
  maxSteps?: number;
  json: boolean;
  keepBooted: boolean;
  /** M8: 크래시 감지 시 fail 강등 여부. 기본 true, --no-fail-on-crash로 비활성화 */
  failOnCrash: boolean;
  /** M11: 이전 빌드 캐시 재사용 */
  reuseBuild: boolean;
  /** M11: 빌드 없이 캐시 artifact만 사용 (없으면 에러) */
  noBuild: boolean;
  /** M11: 시나리오 permissions 자동 grant */
  grantPermissions: boolean;
  /** M11: 비디오 녹화 */
  recordVideo: boolean;
}

const VALID_PLATFORMS: TestPlatform[] = ["android", "ios"];
const VALID_AGENTS: TestAgent[] = ["claude", "codex", "gemini"];

export function parseTestArgs(argv: string[]): TestArgs {
  const prog = makeProgram("test");
  prog.argument("<path>", "프로젝트 경로");
  prog.requiredOption("--platform <platform>", "타겟 플랫폼: android|ios");
  prog.option("--scenario <file>", "시나리오 마크다운 파일 경로");
  prog.option("--agent <agent>", "LLM 에이전트: claude|codex|gemini", "claude");
  prog.option("--api-key <key>", "에이전트 API 키 (없으면 CLI 로그인 사용)");
  prog.option("--device <id>", "디바이스/에뮬레이터 ID");
  prog.option("--out <dir>", "결과 출력 디렉토리");
  prog.option("--timeout <ms>", "에이전트 전체 타임아웃 (ms)", "900000");
  prog.option("--max-steps <n>", "에이전트 최대 스텝 수", "20");
  prog.option("--json", "JSON 형식으로 출력", false);
  prog.option("--keep-booted", "테스트 후 디바이스를 종료하지 않음", false);
  prog.option("--no-fail-on-crash", "크래시 감지 시 fail 강등을 비활성화한다");
  // M11 옵션
  prog.option("--reuse-build", "소스 핑거프린트 일치 시 이전 빌드를 재사용한다", false);
  prog.option("--no-build", "빌드를 수행하지 않고 캐시 artifact만 사용한다 (없으면 에러)", false);
  prog.option("--grant-permissions", "시나리오의 permissions[]를 자동으로 디바이스에 grant한다", false);
  prog.option("--record-video", "앱 실행 중 화면을 비디오로 녹화한다", false);
  prog.parse(["node", "test", ...argv]);

  const opts = prog.opts<{
    platform: string;
    scenario?: string;
    agent: string;
    apiKey?: string;
    device?: string;
    out?: string;
    timeout: string;
    maxSteps: string;
    json: boolean;
    keepBooted: boolean;
    failOnCrash: boolean;
    reuseBuild: boolean;
    build: boolean; // --no-build → opts.build = false
    grantPermissions: boolean;
    recordVideo: boolean;
  }>();

  if (!VALID_PLATFORMS.includes(opts.platform as TestPlatform)) {
    throw new Error(
      `잘못된 --platform 값: '${opts.platform}'. 허용: android, ios`
    );
  }

  if (!VALID_AGENTS.includes(opts.agent as TestAgent)) {
    throw new Error(
      `잘못된 --agent 값: '${opts.agent}'. 허용: claude, codex, gemini`
    );
  }

  return {
    path: prog.args[0]!,
    platform: opts.platform as TestPlatform,
    scenario: opts.scenario,
    agent: opts.agent as TestAgent,
    apiKey: opts.apiKey,
    device: opts.device,
    out: opts.out,
    timeout: parseInt(opts.timeout, 10),
    maxSteps: parseInt(opts.maxSteps, 10),
    json: opts.json,
    keepBooted: opts.keepBooted,
    failOnCrash: opts.failOnCrash !== false, // --no-fail-on-crash 시 false
    reuseBuild: opts.reuseBuild ?? false,
    noBuild: opts.build === false, // --no-build → opts.build = false
    grantPermissions: opts.grantPermissions ?? false,
    recordVideo: opts.recordVideo ?? false,
  };
}
