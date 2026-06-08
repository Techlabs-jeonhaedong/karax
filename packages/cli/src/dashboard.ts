/**
 * karax E2E 라이브 대시보드
 *
 * TTY 환경에서 화면 하단 고정 영역을 in-place 갱신하는 풀 대시보드.
 * 순수 ANSI 이스케이프 코드만 사용 — zero-dependency 철학 준수.
 *
 * 구성:
 *   - 순수 함수: renderBar / formatDuration / applyEvent / renderDashboard / stripAnsi
 *              lerpColor / gradientText / supportsTrueColor / renderBanner
 *   - 부수효과 클래스: LiveDashboard (stderr 렌더, setInterval 관리)
 *
 * stdout은 절대 건드리지 않는다 (--json 결과 전용).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { E2eProgressEvent, E2eProgressPhase } from "@karax/e2e";

// ─── CLI 버전 읽기 ────────────────────────────────────────────────

/**
 * cli package.json에서 버전을 읽는다.
 * 실패 시 "dev" 반환.
 */
function readCliVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const pkgPath = join(dirname(__filename), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return typeof pkg.version === "string" && pkg.version.length > 0
      ? pkg.version
      : "dev";
  } catch {
    return "dev";
  }
}

// ─── 이모지 아이콘 상수 (VS16 부착으로 이모지 프레젠테이션 강제) ─────
//
// VS16(U+FE0F): Variation Selector-16 — 이모지 프레젠테이션 강제 마커.
// 일부 터미널에서 ✅/❌/⚡를 텍스트 프레젠테이션(폭1)으로 렌더할 수 있으므로
// VS16을 뒤에 붙여 이모지 프레젠테이션(폭2)을 강제한다.
// VS16(0xFE0F)은 codePointWidth 함수에서 폭0 처리되므로 displayWidth 계산에 영향 없음.

/** ✅ CHECK MARK BUTTON + VS16 (displayWidth=2) */
const ICON_OK = "✅️";
/** ❌ CROSS MARK + VS16 (displayWidth=2) */
const ICON_ERR = "❌️";
/** ⚡ HIGH VOLTAGE SIGN + VS16 (displayWidth=2) */
const ICON_RUNNING = "⚡️";

// ─── 파이프라인 단계 정의 ───────────────────────────────────────────

/** 파이프라인 순서대로 정렬된 모든 단계 */
export const PHASE_ORDER: E2eProgressPhase[] = [
  "scenario",
  "detect",
  "device",
  "appmap",
  "build",
  "install",
  "launch",
  "agent",
  "crash-scan",
  "report",
];

/** 단계 한국어 라벨 — 라이브 대시보드 박스용 축약형 */
export const PHASE_LABELS: Record<E2eProgressPhase, string> = {
  scenario: "시나리오",
  detect: "감지",
  device: "부팅",
  appmap: "AppMap",
  build: "앱 빌드",
  install: "앱 설치",
  launch: "앱 실행",
  agent: "에이전트",
  "crash-scan": "크래시 분석",
  report: "리포트",
};

/**
 * non-TTY 폴백 전용 풀 라벨 맵.
 * CI 로그 형식 보존을 위해 기존 풀 라벨을 유지한다.
 * PHASE_LABELS와 별도로 관리 — 라이브 박스 폭 제약과 무관.
 */
const FALLBACK_PHASE_LABELS: Record<E2eProgressPhase, string> = {
  scenario: "시나리오 파싱",
  detect: "프레임워크 감지",
  device: "디바이스 부팅",
  appmap: "AppMap 생성",
  build: "앱 빌드",
  install: "앱 설치",
  launch: "앱 실행",
  agent: "에이전트 실행",
  "crash-scan": "크래시 분석",
  report: "리포트 작성",
};

export const PHASE_TOTAL = PHASE_ORDER.length;

// ─── 상태 타입 ────────────────────────────────────────────────────

export interface DashboardState {
  /** 현재까지 진행된 단계 인덱스 (1-based) */
  phaseIndex: number;
  /** 완료된 단계 목록 */
  completedPhases: E2eProgressPhase[];
  /** 현재 진행 중인 단계 */
  currentPhase: E2eProgressPhase | null;
  /** 오류가 발생한 단계 */
  errorPhase: E2eProgressPhase | null;
  /** 세션 시작 Unix ms */
  sessionStartTime: number;
  /** 현재 단계 시작 Unix ms */
  phaseStartTime: number | null;
  /** 가장 최근 이벤트의 detail */
  lastDetail: string | null;
  /** suite 모드: 마지막으로 본 stepIndex */
  lastStepIndex: number | undefined;
  /** suite 모드: 전체 시나리오 수 */
  totalSteps: number | undefined;
  /** 프로젝트 경로 */
  projectPath: string;
  /** 플랫폼 */
  platform: string;
  /** 에이전트 */
  agent: string;
  /** 빌드 커맨드 */
  buildCommand: string | undefined;
  /** 스피너 프레임 인덱스 (인터벌마다 증가) */
  spinnerFrame: number;
  /** 이미 본 단계들 (phaseIndex 중복 증가 방지) */
  seenPhases: Set<E2eProgressPhase>;
}

// ─── 색상 헬퍼 (순수 함수) ────────────────────────────────────────

/** NO_COLOR 또는 강제 off 시 색상 비활성화 여부 판단 */
function isColorEnabled(): boolean {
  return !process.env.NO_COLOR;
}

type AnsiCode = string;

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_GRAY = "\x1b[90m";
const ANSI_WHITE = "\x1b[97m";

function colorize(text: string, ...codes: AnsiCode[]): string {
  if (!isColorEnabled()) return text;
  return `${codes.join("")}${text}${ANSI_RESET}`;
}

// ─── displayWidth: East Asian Width 근사 ────────────────────────

/**
 * 문자열의 터미널 표시 폭을 반환한다 (East Asian Width 근사).
 *
 * - 전각(CJK·한글·이모지 등): 2칸
 * - 결합 문자·NUL·제어문자: 0칸
 * - 그 외: 1칸
 *
 * zero-dependency: string-width 같은 npm 패키지 없이 직접 구현.
 * 박스 드로잉 문자(─│┃┏ 등), ✓, ▶, █, ░ 는 의도적으로 1칸 처리.
 */
export function displayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    width += codePointWidth(cp);
  }
  return width;
}

/**
 * 이모지 표시 폭이 2인 코드포인트들을 명시적으로 열거한다.
 *
 * 배경: ✅(U+2705), ❌(U+274C), ⚡(U+26A1)은 0x1F300~0x1FAFF 범위 밖(Misc Symbols/Dingbats)이라
 * 기존 범위 기반 처리만으로는 1로 잘못 계산됨 → 불변식 파괴.
 *
 * 해결: 대시보드에서 사용하는 이모지를 명시적으로 폭2 처리.
 * 박스 드로잉(─│┃ 등), 기하학적 도형(▶◉) 등 폭1 문자는 그대로 유지.
 */
const EXPLICIT_WIDTH2_CODEPOINTS = new Set<number>([
  0x2705, // ✅ CHECK MARK BUTTON
  0x274c, // ❌ CROSS MARK
  0x26a1, // ⚡ HIGH VOLTAGE SIGN
  0x2728, // ✨ SPARKLES
  0x2764, // ❤  HEAVY BLACK HEART
  0x26a0, // ⚠  WARNING SIGN
  0x2b50, // ⭐ WHITE MEDIUM STAR
  0x2b55, // ⭕ HEAVY LARGE CIRCLE
  0x274e, // ❎ NEGATIVE SQUARED CROSS MARK
  0x2753, // ❓ BLACK QUESTION MARK ORNAMENT
  0x2757, // ❗ HEAVY EXCLAMATION MARK ORNAMENT
]);

function codePointWidth(cp: number): number {
  // NUL
  if (cp === 0x0000) return 0;
  // 제어문자 (C0: 0x01-0x1F, DEL: 0x7F, C1: 0x80-0x9F)
  if (cp <= 0x001f || cp === 0x007f || (cp >= 0x0080 && cp <= 0x009f)) return 0;
  // 결합 문자 (대표 범위)
  if (
    (cp >= 0x0300 && cp <= 0x036f) || // Combining Diacritical Marks
    (cp >= 0x0483 && cp <= 0x0489) || // Combining Cyrillic
    (cp >= 0x0591 && cp <= 0x05bd) || // Hebrew combining
    (cp >= 0x0610 && cp <= 0x061a) || // Arabic combining
    (cp >= 0x064b && cp <= 0x065f) || // Arabic combining
    (cp >= 0x1ab0 && cp <= 0x1aff) || // Combining Diacritical Marks Extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // Combining Diacritical Marks Supplement
    (cp >= 0x20d0 && cp <= 0x20ff) || // Combining Diacritical Marks for Symbols
    (cp >= 0xfe20 && cp <= 0xfe2f)    // Combining Half Marks
  ) return 0;
  // Unicode variation selectors (폭 0으로 처리)
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;

  // 명시적 폭2 이모지 (Misc Symbols/Dingbats 범위 이모지로, 범위 기반 처리 전에 체크)
  if (EXPLICIT_WIDTH2_CODEPOINTS.has(cp)) return 2;

  // 전각 2칸 범위
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||  // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) ||  // CJK Radicals ~ CJK Symbols
    (cp >= 0x3041 && cp <= 0x33ff) ||  // Hiragana/Katakana/CJK Compat/CJK Unified Ideographs Ext A range
    (cp >= 0x3400 && cp <= 0x4dbf) ||  // CJK Ext-A
    (cp >= 0x4e00 && cp <= 0x9fff) ||  // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) ||  // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) ||  // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||  // CJK Compat Ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) ||  // CJK Compat Forms
    (cp >= 0xff00 && cp <= 0xff60) ||  // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||  // Fullwidth Signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // Emoji (BMP 이상 이모지)
    (cp >= 0x20000 && cp <= 0x3fffd)   // CJK Ext-B+
  ) return 2;

  return 1;
}

// ─── truncateToWidth: displayWidth 기준 truncate ─────────────────

/**
 * displayWidth 기준으로 문자열을 자른다.
 * 잘리면 마지막에 `…`(폭1)을 붙이되 결과 displayWidth가 maxWidth를 넘지 않게 한다.
 */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(text) <= maxWidth) return text;

  // 한 코드포인트씩 순회하며 maxWidth-1(ellipsis 여유) 내로 자름
  const ellipsisWidth = 1; // "…"의 displayWidth
  const budget = maxWidth - ellipsisWidth;
  if (budget <= 0) return "…".slice(0, maxWidth > 0 ? 1 : 0);

  let acc = 0;
  let result = "";
  for (const char of text) {
    const cp = char.codePointAt(0);
    const w = cp !== undefined ? codePointWidth(cp) : 1;
    if (acc + w > budget) break;
    acc += w;
    result += char;
  }
  return result + "…";
}

// ─── physicalRows: 물리 행 수 계산 ───────────────────────────────

/**
 * 라인 배열에서 주어진 termWidth 기준 실제 물리 행 수의 합을 반환한다.
 * 각 라인에 대해 Math.max(1, Math.ceil(displayWidth(stripAnsi(line)) / termWidth))를 합산.
 * ANSI 코드는 strip 후 계산한다.
 *
 * @param termWidth 터미널 너비(열 수). **1 이상이어야 한다.**
 *   0 이하이면 제수가 0이 돼 Infinity가 반환되므로, 안전하게 lines.length를 반환한다.
 */
export function physicalRows(lines: string[], termWidth: number): number {
  if (lines.length === 0) return 0;
  if (termWidth <= 0) return lines.length;
  return lines.reduce((sum, line) => {
    const w = displayWidth(stripAnsi(line));
    return sum + Math.max(1, Math.ceil(w / termWidth));
  }, 0);
}

/** ANSI 이스케이프 코드를 제거한다 (테스트 및 색상 strip용)
 *
 * 처리 대상:
 *   - CSI 시퀀스: \x1b[...m, \x1b[...A 등 (컬러·커서)
 *   - OSC 시퀀스: \x1b]...\x07 또는 \x1b]...\x1b\\ (ST)
 *   - 문자셋 지정: \x1b( \x1b)
 *   - DEC 프라이빗: \x1b#
 */
export function stripAnsi(str: string): string {
  // OSC: \x1b] ... \x07  또는  \x1b] ... \x1b\  (ST)
  // eslint-disable-next-line no-control-regex
  let s = str.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  // CSI: \x1b[ ... (파라미터) + 최종 바이트 (하나의 알파벳)
  // eslint-disable-next-line no-control-regex
  s = s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  // 문자셋 지정: \x1b( X 또는 \x1b) X
  // eslint-disable-next-line no-control-regex
  s = s.replace(/\x1b[()][0-9A-Za-z]/g, "");
  // DEC 프라이빗: \x1b# X
  // eslint-disable-next-line no-control-regex
  s = s.replace(/\x1b#[0-9]/g, "");
  // 남은 고립 ESC 제거
  // eslint-disable-next-line no-control-regex
  s = s.replace(/\x1b/g, "");
  return s;
}

/**
 * 외부 입력 문자열을 터미널 출력용으로 정화한다 (보안 필수).
 *
 * 1. 입력 길이 상한(4096자)으로 잘라낸다 — ReDoS·성능 저하 방지
 * 2. stripAnsi()로 모든 ANSI/OSC/문자셋/DEC 시퀀스 제거
 * 3. 개행·캐리지리턴·탭 등 제어문자를 공백으로 치환
 *
 * 순수 함수 — 부수효과 없음.
 */
export function sanitizeForTerminal(s: string): string {
  const MAX_LEN = 4096;
  const truncated = s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
  const noAnsi = stripAnsi(truncated);
  // eslint-disable-next-line no-control-regex
  return noAnsi.replace(/[\n\r\t\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");
}

// ─── 트루컬러 그라데이션 헬퍼 (순수 함수) ────────────────────────

/**
 * 트루컬러(24bit) 지원 여부를 반환한다.
 *
 * - NO_COLOR 환경변수가 있으면 항상 false
 * - COLORTERM이 "truecolor" 또는 "24bit"이면 true
 * - 그 외엔 false
 */
export function supportsTrueColor(): boolean {
  if (process.env.NO_COLOR) return false;
  const ct = process.env.COLORTERM;
  return ct === "truecolor" || ct === "24bit";
}

/**
 * 두 RGB 색 사이를 선형 보간한다.
 *
 * @param from [r, g, b] (0~255)
 * @param to   [r, g, b] (0~255)
 * @param t    보간 계수 (0~1, 클램프 처리됨)
 * @returns    보간된 [r, g, b]
 */
export function lerpColor(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    Math.round(from[0] + (to[0] - from[0]) * clamped),
    Math.round(from[1] + (to[1] - from[1]) * clamped),
    Math.round(from[2] + (to[2] - from[2]) * clamped),
  ];
}

/**
 * 텍스트에 가로 그라데이션을 적용한다.
 *
 * - 트루컬러 지원 + NO_COLOR 없을 때만 24bit ANSI 적용
 * - NO_COLOR 또는 트루컬러 미지원 시 원문 그대로 반환 (단색 ANSI 없음)
 * - stripAnsi 후 항상 원문과 동일 (폭 불변)
 *
 * @param text  출력할 텍스트 (코드포인트 단위로 순회)
 * @param from  시작 RGB 색
 * @param to    끝 RGB 색
 *
 * @warning 정적 UI 텍스트(로고/라벨)에만 사용할 것.
 *   buildCommand·detail 같은 외부 입력에는 절대 적용 금지.
 *   외부 입력에 적용하면 ANSI 인젝션 및 출력 팽창 위험이 있음.
 *   외부 입력은 반드시 sanitizeForTerminal()로 정화한 뒤 colorize()만 사용할 것.
 */
export function gradientText(
  text: string,
  from: [number, number, number],
  to: [number, number, number],
): string {
  if (!isColorEnabled() || !supportsTrueColor()) return text;
  if (text.length === 0) return text;

  // 코드포인트 배열로 분리 (서로게이트 쌍 처리)
  const chars = [...text];
  const total = chars.length;
  if (total === 1) {
    const [r, g, b] = from;
    return `\x1b[38;2;${r};${g};${b}m${chars[0]}${ANSI_RESET}`;
  }

  let result = "";
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    const [r, g, b] = lerpColor(from, to, t);
    result += `\x1b[38;2;${r};${g};${b}m${chars[i]}`;
  }
  result += ANSI_RESET;
  return result;
}

// ─── KARAX ASCII 아트 로고 (ANSI Shadow 스타일) ───────────────────

/**
 * KARAX ANSI Shadow 스타일 로고 라인 배열.
 * 각 라인의 displayWidth = 41 (5글자 × 8 + 공백).
 * 반드시 termWidth ≥ LOGO_WIDTH일 때만 사용할 것.
 */
const LOGO_LINES = [
  "██╗  ██╗ █████╗ ██████╗  █████╗ ██╗  ██╗",
  "██║ ██╔╝██╔══██╗██╔══██╗██╔══██╗╚██╗██╔╝",
  "█████╔╝ ███████║██████╔╝███████║ ╚███╔╝ ",
  "██╔═██╗ ██╔══██║██╔══██╗██╔══██║ ██╔██╗ ",
  "██║  ██╗██║  ██║██║  ██║██║  ██║██╔╝ ██╗",
  "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝",
];

/** 로고 표시에 필요한 최소 폭 */
const LOGO_WIDTH = 42;

/** 그라데이션 색상 팔레트 (로고 세로 / 진행바 가로 공유) */
const GRAD_CYAN: [number, number, number] = [0, 200, 220];    // 시안
const GRAD_MAGENTA: [number, number, number] = [180, 60, 220]; // 마젠타

/** 세로 그라데이션 색상: 위(시안) → 아래(마젠타) */
const LOGO_COLOR_TOP = GRAD_CYAN;
const LOGO_COLOR_BOTTOM = GRAD_MAGENTA;

/** 가로 그라데이션 색상: 왼쪽(시안) → 오른쪽(마젠타) */
const BAR_COLOR_LEFT = GRAD_CYAN;
const BAR_COLOR_RIGHT = GRAD_MAGENTA;

/**
 * 배너를 렌더링한다 (순수 함수).
 *
 * - termWidth >= LOGO_WIDTH: ASCII 아트 로고 + 서브타이틀
 * - termWidth < LOGO_WIDTH: 텍스트 폴백 ("KARAX · E2E 테스트 자동화 vX.Y")
 * - 트루컬러 지원 시 세로 그라데이션(로고) 또는 단색(폴백) 적용
 * - NO_COLOR 시 색 없음
 * - 모든 반환 라인의 displayWidth(stripAnsi(line)) ≤ termWidth
 *
 * @param opts.version  표시할 버전 문자열 (cli package.json에서 읽거나 "dev")
 * @param opts.termWidth 터미널 폭
 */
export function renderBanner(opts: {
  version: string;
  termWidth: number;
}): string[] {
  const { termWidth } = opts;
  // 외부에서 읽은 version에 ANSI 인젝션 방어 — sanitize 후 사용
  const version = sanitizeForTerminal(opts.version);
  const lines: string[] = [];

  if (termWidth >= LOGO_WIDTH) {
    // ─── 풀 로고 모드 ────────────────────────────────────────────
    const totalRows = LOGO_LINES.length;
    for (let i = 0; i < totalRows; i++) {
      const logoLine = LOGO_LINES[i];
      const t = totalRows <= 1 ? 0 : i / (totalRows - 1);

      let coloredLine: string;
      if (isColorEnabled() && supportsTrueColor()) {
        // 세로 그라데이션: 행별로 단색(그 행의 보간색) 적용
        const [r, g, b] = lerpColor(LOGO_COLOR_TOP, LOGO_COLOR_BOTTOM, t);
        coloredLine = `\x1b[1m\x1b[38;2;${r};${g};${b}m${logoLine}${ANSI_RESET}`;
      } else if (isColorEnabled()) {
        // 단색 폴백: 시안
        coloredLine = colorize(logoLine, ANSI_BOLD, ANSI_CYAN);
      } else {
        coloredLine = logoLine;
      }
      lines.push(coloredLine);
    }

    // 서브타이틀: "╰─ E2E 테스트 자동화 · vX.Y ─╯"
    const subtitleText = `╰─ E2E 테스트 자동화 · v${version} ─╯`;
    const subtitleWidth = displayWidth(subtitleText);
    const subtitleLine =
      subtitleWidth <= termWidth
        ? colorize(subtitleText, ANSI_DIM)
        : colorize(truncateToWidth(subtitleText, termWidth), ANSI_DIM);
    lines.push(subtitleLine);
  } else {
    // ─── 텍스트 폴백 모드 ─────────────────────────────────────────
    const fallbackText = `KARAX · E2E 테스트 자동화 v${version}`;
    const truncated = truncateToWidth(fallbackText, termWidth);
    lines.push(colorize(truncated, ANSI_BOLD, ANSI_CYAN));
  }

  return lines;
}

// ─── 순수 함수: renderBar ─────────────────────────────────────────

/**
 * 진행바 문자열을 생성한다.
 *
 * @param ratio 0~1 (클램프 처리됨)
 * @param width 전체 폭 (문자 수)
 * @returns "████░░░░" 형태 문자열 (ANSI 없음)
 */
export function renderBar(ratio: number, width: number): string {
  if (width <= 0) return "";
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ─── 순수 함수: formatDuration ────────────────────────────────────

/**
 * 경과 ms를 사람이 읽기 쉬운 문자열로 변환한다.
 *
 * - 0ms → "0.0s"
 * - 1500ms → "1.5s"
 * - 62000ms → "1m02s"
 * - 음수 → "0.0s"
 */
export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSec = safeMs / 1000;
  if (totalSec < 60) {
    return `${totalSec.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

// ─── 순수 함수: applyEvent (상태 reducer) ────────────────────────

/**
 * 진행 이벤트를 현재 상태에 적용해 새 상태를 반환한다.
 * 완전히 순수 — 부수효과 없음.
 *
 * heartbeat 이벤트는 phaseIndex/seenPhases/lastDetail을 변경하지 않는다.
 */
export function applyEvent(
  state: DashboardState,
  event: E2eProgressEvent,
  now: number,
): DashboardState {
  // heartbeat: 카운터/상태 변경 없이 반환
  if (event.heartbeat === true) {
    return state;
  }

  let next = { ...state, seenPhases: new Set(state.seenPhases) };

  // suite 모드: stepIndex가 바뀌면 phaseIndex/seenPhases 리셋
  if (
    event.stepIndex !== undefined &&
    event.stepIndex !== state.lastStepIndex
  ) {
    next.phaseIndex = 0;
    next.seenPhases = new Set<E2eProgressPhase>();
    next.lastStepIndex = event.stepIndex;
  }

  if (event.totalSteps !== undefined) {
    next.totalSteps = event.totalSteps;
  }

  if (event.status === "start") {
    // 처음 보는 단계만 phaseIndex 증가
    if (!next.seenPhases.has(event.phase)) {
      next.phaseIndex = next.phaseIndex + 1;
      next.seenPhases = new Set(next.seenPhases);
      next.seenPhases.add(event.phase);
    }
    next.currentPhase = event.phase;
    next.phaseStartTime = now;
    if (event.detail !== undefined) {
      next.lastDetail = event.detail;
    }
  } else if (event.status === "done") {
    // 완료 처리: completedPhases에 추가 (중복 방지)
    if (!next.completedPhases.includes(event.phase)) {
      next.completedPhases = [...next.completedPhases, event.phase];
    }
    // 같은 phase가 currentPhase이면 해제
    if (next.currentPhase === event.phase) {
      next.currentPhase = null;
      next.phaseStartTime = null;
    }
    if (event.detail !== undefined) {
      next.lastDetail = event.detail;
    }
  } else if (event.status === "error") {
    next.errorPhase = event.phase;
    if (next.currentPhase === event.phase) {
      next.currentPhase = null;
    }
    if (event.detail !== undefined) {
      next.lastDetail = event.detail;
    }
  }

  return next;
}

// ─── 순수 함수: renderDashboard ──────────────────────────────────

/**
 * 스피너 프레임 배열 (경과초 표시와 함께 사용)
 * 빌드처럼 총 시간을 알 수 없는 단계에 indeterminate 표시
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * 대시보드 전체 라인 배열을 생성한다.
 *
 * @param state 현재 대시보드 상태
 * @param termWidth 터미널 폭 (기본 80)
 * @param now 현재 Unix ms (경과시간 계산용)
 * @returns 출력할 라인 배열 (ANSI 포함 or NO_COLOR이면 없음)
 */
export function renderDashboard(
  state: DashboardState,
  termWidth: number,
  now: number,
): string[] {
  // 박스 내부 폭 계산 (┃ 양쪽 1자 + 공백 1자씩 = 4자 제외)
  // 박스 테두리·진행바·라벨은 ASCII/박스문자라 폭1이므로 자 단위 계산 유지
  const boxWidth = Math.max(20, termWidth - 2);
  const innerWidth = boxWidth - 4; // "┃ " + " ┃"

  // 박스 라인 생성 헬퍼 — displayWidth 기준으로 패딩 계산
  const boxLine = (content: string): string => {
    const strippedWidth = displayWidth(stripAnsi(content));
    const padLen = Math.max(0, innerWidth - strippedWidth);
    const padded = content + " ".repeat(padLen);
    return colorize("┃", ANSI_GRAY) + " " + padded + " " + colorize("┃", ANSI_GRAY);
  };

  // ANSI 포함 문자열을 displayWidth 기준으로 truncate (색상 손실 허용, 안전 폴백)
  const truncateAnsi = (text: string, maxW: number): string => {
    const stripped = stripAnsi(text);
    if (displayWidth(stripped) <= maxW) return text;
    return truncateToWidth(stripped, maxW);
  };

  const lines: string[] = [];

  // ─── 1. 상단 박스 ─────────────────────────────────────────────

  // 상단 테두리: ┏━ karax E2E ━━━━━━━━━━━┓
  // titleText는 ASCII만이므로 displayWidth == .length
  const titleText = " karax E2E ";
  const titleInner = colorize(titleText, ANSI_BOLD, ANSI_CYAN);
  const titleRaw = titleText;
  const dashCount = Math.max(0, boxWidth - 2 - titleRaw.length - 2); // ┏ + titleRaw + ━...━ + ┓
  const topBorder =
    colorize("┏", ANSI_GRAY) +
    colorize("━", ANSI_GRAY) +
    titleInner +
    colorize("━".repeat(dashCount), ANSI_GRAY) +
    colorize("┓", ANSI_GRAY);
  lines.push(topBorder);

  // 전체 진행바 라인 (phaseIndex 기반 — "현재 단계까지 포함한 진행 위치")
  // 새 스타일: ⏺(채움, displayWidth=1) / ·(빈칸, displayWidth=1) + 가로 그라데이션
  const progressCount = state.phaseIndex;
  const progressRatio = PHASE_TOTAL > 0 ? progressCount / PHASE_TOTAL : 0;
  const progressPct = Math.round(progressRatio * 100);
  // progressLabel: " 5/10  50%" — 모두 ASCII → displayWidth == length
  const progressLabel = ` ${progressCount}/${PHASE_TOTAL}  ${String(progressPct).padStart(3)}%`;
  const progressLabelWidth = progressLabel.length;
  const barWidth = Math.max(4, innerWidth - progressLabelWidth);
  const filledCount = Math.round(progressRatio * barWidth);

  let barColored: string;
  if (!isColorEnabled()) {
    barColored = "⏺".repeat(filledCount) + "·".repeat(barWidth - filledCount);
  } else if (supportsTrueColor()) {
    // 가로 그라데이션: 채워진 구간만 그라데이션, 빈 구간은 단색 dim
    let barStr = "";
    for (let i = 0; i < filledCount; i++) {
      const t = barWidth <= 1 ? 0 : i / (barWidth - 1);
      const [r, g, b] = lerpColor(BAR_COLOR_LEFT, BAR_COLOR_RIGHT, t);
      barStr += `\x1b[38;2;${r};${g};${b}m⏺`;
    }
    if (filledCount > 0) barStr += ANSI_RESET;
    barStr += colorize("·".repeat(barWidth - filledCount), ANSI_GRAY);
    barColored = barStr;
  } else {
    // 단색 폴백
    barColored =
      colorize("⏺".repeat(filledCount), ANSI_CYAN) +
      colorize("·".repeat(barWidth - filledCount), ANSI_GRAY);
  }
  lines.push(boxLine(barColored + colorize(progressLabel, ANSI_WHITE)));

  // 헤더 라인: projectPath · platform · agent · 총 경과시간
  // projectPath에 한글이 있을 수 있으므로 displayWidth 기준으로 truncate
  const elapsed = formatDuration(now - state.sessionStartTime);
  const pathBudget = Math.max(10, Math.floor(innerWidth * 0.4));
  let headerParts = [
    truncateToWidth(state.projectPath, pathBudget),
    state.platform,
    state.agent,
    elapsed,
  ];

  // suite 모드: 시나리오 인덱스 표시
  if (state.lastStepIndex !== undefined && state.totalSteps !== undefined) {
    headerParts = [
      `[시나리오 ${state.lastStepIndex + 1}/${state.totalSteps}]`,
      ...headerParts,
    ];
  }

  const headerText = headerParts.join(" · ");
  const headerTruncated = truncateToWidth(headerText, innerWidth);
  lines.push(boxLine(colorize(headerTruncated, ANSI_DIM)));

  // 하단 테두리
  const bottomBorder =
    colorize("┗", ANSI_GRAY) +
    colorize("━".repeat(boxWidth - 2), ANSI_GRAY) +
    colorize("┛", ANSI_GRAY);
  lines.push(bottomBorder);

  // ─── 2. 완료된 단계들 — 한 줄에 모아 표시 ─────────────────────
  // 완료 아이콘: ICON_OK (✅️, displayWidth=2) → displayWidth 계산에 반영됨

  if (state.completedPhases.length > 0) {
    const completedParts = state.completedPhases.map((phase) => {
      const label = PHASE_LABELS[phase] ?? phase;
      // "ICON_OK label" — 아이콘 폭2이므로 뒤 공백 없이 붙여도 됨
      return colorize(`${ICON_OK} ${label}`, ANSI_GREEN);
    });
    const completedStrippedParts = completedParts.map(stripAnsi);
    const completedText = completedParts.join("  ");
    const completedStripped = completedStrippedParts.join("  ");
    // displayWidth 기준으로 truncate
    const truncated = isColorEnabled()
      ? truncateAnsi(completedText, innerWidth)
      : truncateToWidth(completedStripped, innerWidth);
    lines.push(" " + truncated);
  }

  // ─── 3. 에러 단계 ─────────────────────────────────────────────
  // 에러 아이콘: ICON_ERR (❌️, displayWidth=2)

  if (state.errorPhase !== null) {
    const label = PHASE_LABELS[state.errorPhase] ?? state.errorPhase;
    // "ICON_ERR <label>": 아이콘=폭2, 공백=폭1, label 폭 → 합산 후 termWidth-1 이하로 truncate
    const prefix = `${ICON_ERR} `;
    const prefixWidth = displayWidth(prefix);
    const labelBudget = Math.max(1, termWidth - 1 - prefixWidth);
    const labelTruncated = truncateToWidth(label, labelBudget);
    const errorText = prefix + labelTruncated;
    lines.push(" " + colorize(errorText, ANSI_RED));
  }

  // ─── 4. 현재 진행 단계 ────────────────────────────────────────
  // 진행 아이콘: ICON_RUNNING (⚡️, displayWidth=2)

  if (state.currentPhase !== null) {
    const label = PHASE_LABELS[state.currentPhase] ?? state.currentPhase;
    const phaseElapsed = state.phaseStartTime !== null
      ? formatDuration(now - state.phaseStartTime)
      : "0.0s";
    const spinner = SPINNER_FRAMES[state.spinnerFrame % SPINNER_FRAMES.length];
    // "ICON_RUNNING <label>  <spinner> <elapsed>" — 아이콘=폭2, label에 한글 있을 수 있음
    // overhead: " ICON_RUNNING " + "  " + spinner(폭1) + " " + elapsed
    const overheadRaw = `${ICON_RUNNING} ` + `  ${spinner} ${phaseElapsed}`;
    const overhead = displayWidth(overheadRaw) + 1; // 앞 " " 여유
    const maxCurrentWidth = termWidth - 1; // 앞 " " 1자 여유
    const labelBudget = Math.max(2, maxCurrentWidth - overhead);
    const labelTruncated = truncateToWidth(label, labelBudget);
    const currentLine = `${ICON_RUNNING} ${labelTruncated}  ${colorize(spinner, ANSI_YELLOW)} ${phaseElapsed}`;
    lines.push(" " + currentLine);

    // 빌드 커맨드 요약 (build 단계일 때) — sanitize 후 출력
    if (state.currentPhase === "build" && state.buildCommand !== undefined) {
      const cmdSafe = sanitizeForTerminal(state.buildCommand);
      // "   " 접두사(3자) + cmd → 전체 termWidth 이하
      const cmdText = truncateToWidth(cmdSafe, Math.max(4, termWidth - 3));
      lines.push("   " + colorize(cmdText, ANSI_DIM));
    }
  }

  // ─── 5. 구분선 ────────────────────────────────────────────────
  // 박스 폭(boxWidth)에 맞춰 정렬: " " + "─".repeat(boxWidth - 2) → 앞 " " 포함 boxWidth-1 폭
  // boxWidth = termWidth - 2이므로 구분선 전체 폭 = 1 + (boxWidth - 2) = boxWidth - 1 ≤ termWidth
  lines.push(" " + colorize("─".repeat(Math.max(1, boxWidth - 2)), ANSI_GRAY));

  // ─── 6. 최근 detail — sanitize 후 출력 ───────────────────────

  if (state.lastDetail !== null) {
    const detailSafe = sanitizeForTerminal(state.lastDetail);
    // "최근: " = 4글자(한글2×2+": ") = displayWidth 6; 앞 " " 포함 총 7
    const prefixWidth = displayWidth("최근: ") + 1; // " " + "최근: "
    const detailText = truncateToWidth(detailSafe, Math.max(4, termWidth - prefixWidth));
    lines.push(" " + colorize("최근: ", ANSI_DIM) + colorize(detailText, ANSI_GRAY));
  }

  return lines;
}

// ─── LiveDashboard 클래스 (부수효과) ─────────────────────────────

/**
 * E2E 진행 이벤트를 수신해 stderr에 라이브 대시보드를 렌더링한다.
 *
 * TTY + NO_COLOR 없을 때만 라이브 모드; 그 외는 non-TTY 폴백(기존 라인 방식).
 */
export class LiveDashboard {
  private state: DashboardState;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** resize 이벤트 debounce 타이머 — 80ms 내 중복 resize를 단일 렌더로 합산 */
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 마지막 렌더 라인 목록 — 물리행 계산에 사용 */
  private lastLines: string[] = [];
  private readonly isLive: boolean;
  /** non-TTY 폴백에서 쓰는 stepStartTimes */
  private readonly stepStartTimes = new Map<string, number>();

  constructor(opts: {
    projectPath: string;
    platform: string;
    agent: string;
    buildCommand?: string;
  }) {
    this.isLive =
      process.stderr.isTTY === true && !process.env.NO_COLOR;

    this.state = {
      phaseIndex: 0,
      completedPhases: [],
      currentPhase: null,
      errorPhase: null,
      sessionStartTime: Date.now(),
      phaseStartTime: null,
      lastDetail: null,
      lastStepIndex: undefined,
      totalSteps: undefined,
      projectPath: opts.projectPath,
      platform: opts.platform,
      agent: opts.agent,
      buildCommand: opts.buildCommand,
      spinnerFrame: 0,
      seenPhases: new Set(),
    };
  }

  /** 대시보드 시작 (타이머 등록, 커서 숨김) */
  start(): void {
    if (!this.isLive) return;

    // 배너 출력 (1회, 스크롤백에 고정 — lastLines에 포함하지 않음)
    const termWidth = process.stderr.columns || 80;
    const version = readCliVersion();
    const bannerLines = renderBanner({ version, termWidth });
    process.stderr.write(bannerLines.join("\n") + "\n");

    // 커서 숨김
    process.stderr.write("\x1b[?25l");

    // SIGINT 훅 및 resize 리스너 등록
    process.on("SIGINT", this._onSigint);
    process.stderr.on("resize", this._onResize);

    // 초기 렌더
    this._render();

    // 갱신 타이머 (150ms — 부드러운 경과초/스피너 갱신)
    this.timer = setInterval(() => {
      this.state = { ...this.state, spinnerFrame: this.state.spinnerFrame + 1 };
      this._render();
    }, 150);

    // 프로세스 종료를 막지 않게
    if (
      this.timer !== null &&
      typeof (this.timer as NodeJS.Timeout).unref === "function"
    ) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /** 진행 이벤트 처리 */
  handleEvent(event: E2eProgressEvent): void {
    if (this.isLive) {
      this.state = applyEvent(this.state, event, Date.now());
      this._render();
    } else {
      // non-TTY 폴백에서도 상태를 동기화해서 phaseIndex를 올바르게 유지
      this.state = applyEvent(this.state, event, Date.now());
      this._fallbackLog(event);
    }
  }

  /** 완료 처리: 타이머 정리 + 최종 렌더 + 커서 복원 */
  stop(): void {
    this._cleanup();
    if (this.isLive) {
      this._render(); // 최종 상태 한 번 더 그리기
      process.stderr.write("\n"); // 커서 아래로
    }
  }

  /** 에러 종료: 에러 상태로 표시 + 커서 복원 */
  fail(phase?: E2eProgressPhase): void {
    if (phase !== undefined) {
      this.state = { ...this.state, errorPhase: phase, currentPhase: null };
    }
    this._cleanup();
    if (this.isLive) {
      this._render();
      process.stderr.write("\n");
    }
  }

  // ─── private ────────────────────────────────────────────────

  private _cleanup(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    process.removeListener("SIGINT", this._onSigint);
    process.stderr.removeListener("resize", this._onResize);
    if (this.isLive) {
      // 커서 복원
      process.stderr.write("\x1b[?25h");
    }
  }

  private readonly _onSigint = (): void => {
    this._cleanup();
    process.exit(130); // 128 + SIGINT(2)
  };

  /** resize 이벤트 핸들러 — 80ms debounce 후 재렌더 (렌더 폭주 방지) */
  private readonly _onResize = (): void => {
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this._render();
    }, 80);
    // 프로세스 종료를 막지 않게
    if (
      this.resizeTimer !== null &&
      typeof (this.resizeTimer as NodeJS.Timeout).unref === "function"
    ) {
      (this.resizeTimer as NodeJS.Timeout).unref();
    }
  };

  private _render(): void {
    if (!this.isLive) return;

    const termWidth = process.stderr.columns || 80;
    const now = Date.now();
    const lines = renderDashboard(this.state, termWidth, now);

    // 직전 라인을 덮어쓰기: lastLines를 현재 termWidth로 물리행 수 계산 후 커서를 올린다.
    // renderDashboard 불변식(모든 라인 displayWidth ≤ termWidth)이 보장되면
    // 평상시엔 rows == lastLines.length이고, resize 시에도 정확히 지운다.
    if (this.lastLines.length > 0) {
      const rows = physicalRows(this.lastLines, termWidth);
      process.stderr.write(
        `\x1b[${rows}A` + // 물리 행 수만큼 위로 이동
        "\x1b[0J",        // 아래 전체 지우기
      );
    }

    process.stderr.write(lines.join("\n") + "\n");
    this.lastLines = lines;
  }

  /** non-TTY 폴백: 풀 라벨 + sanitize 적용 (CI 로그 형식 보존) */
  private _fallbackLog(event: E2eProgressEvent): void {
    // 폴백은 FALLBACK_PHASE_LABELS(풀 라벨)를 사용해 CI 로그 형식 유지
    const label = FALLBACK_PHASE_LABELS[event.phase] ?? event.phase;
    const key = `${event.stepIndex ?? ""}-${event.phase}`;

    if (event.heartbeat === true) {
      const startTime = this.stepStartTimes.get(key);
      const elapsedStr =
        startTime !== undefined
          ? ` (${((Date.now() - startTime) / 1000).toFixed(1)}s 경과)`
          : "";
      process.stderr.write(`${label} 진행 중${elapsedStr}\n`);
      return;
    }

    if (event.status === "start") {
      this.stepStartTimes.set(key, Date.now());
      const suitePrefix =
        event.stepIndex !== undefined && event.totalSteps !== undefined
          ? `[시나리오 ${event.stepIndex + 1}/${event.totalSteps}] `
          : "";
      const phaseIdx = this.state.phaseIndex;
      const detail = event.detail ? ` — ${sanitizeForTerminal(event.detail)}` : "";
      process.stderr.write(
        `${suitePrefix}[${phaseIdx}/${PHASE_TOTAL}] ${label} 시작${detail}\n`,
      );
    } else if (event.status === "done") {
      const startTime = this.stepStartTimes.get(key);
      const elapsedStr =
        startTime !== undefined
          ? ` (${((Date.now() - startTime) / 1000).toFixed(1)}s)`
          : "";
      const detail = event.detail ? ` — ${sanitizeForTerminal(event.detail)}` : "";
      process.stderr.write(`✓ ${label} 완료${elapsedStr}${detail}\n`);
    } else if (event.status === "error") {
      const detail = event.detail ? `: ${sanitizeForTerminal(event.detail)}` : "";
      process.stderr.write(`✗ ${label} 오류${detail}\n`);
    }
  }
}
