/**
 * CLI 커맨드 파서 — commander 기반
 *
 * 각 parse* 함수는 commander를 사용해 argv 배열을 파싱하고
 * 결과 옵션 객체를 반환한다. bin.ts가 이 함수들을 사용한다.
 */

import { Command } from "commander";
import type { CaptureMode } from "@sfc/sdk";

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

// ── mcp-config ────────────────────────────────────────────────────

export interface McpConfigArgs {
  // 현재는 옵션 없음
}

export function parseMcpConfigArgs(_argv: string[]): McpConfigArgs {
  return {};
}
