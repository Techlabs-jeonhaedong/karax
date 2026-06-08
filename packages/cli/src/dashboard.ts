/**
 * karax E2E 라이브 대시보드
 *
 * TTY 환경에서 화면 하단 고정 영역을 in-place 갱신하는 풀 대시보드.
 * 순수 ANSI 이스케이프 코드만 사용 — zero-dependency 철학 준수.
 *
 * 구성:
 *   - 순수 함수: renderBar / formatDuration / applyEvent / renderDashboard / stripAnsi
 *   - 부수효과 클래스: LiveDashboard (stderr 렌더, setInterval 관리)
 *
 * stdout은 절대 건드리지 않는다 (--json 결과 전용).
 */

import type { E2eProgressEvent, E2eProgressPhase } from "@karax/e2e";

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
  const boxWidth = Math.max(20, termWidth - 2);
  const innerWidth = boxWidth - 4; // "┃ " + " ┃"

  // 텍스트 truncate 헬퍼
  const truncate = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "…";
  };

  // 박스 라인 생성 헬퍼
  const boxLine = (content: string): string => {
    const stripped = stripAnsi(content);
    const padLen = Math.max(0, innerWidth - stripped.length);
    const padded = content + " ".repeat(padLen);
    return colorize("┃", ANSI_GRAY) + " " + padded + " " + colorize("┃", ANSI_GRAY);
  };

  const lines: string[] = [];

  // ─── 1. 상단 박스 ─────────────────────────────────────────────

  // 상단 테두리: ┏━ karax E2E ━━━━━━━━━━━┓
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
  const progressCount = state.phaseIndex;
  const progressRatio = PHASE_TOTAL > 0 ? progressCount / PHASE_TOTAL : 0;
  const progressPct = Math.round(progressRatio * 100);
  const barWidth = Math.max(4, innerWidth - 12); // "X/10  100%" 부분 제외
  const bar = renderBar(progressRatio, barWidth);
  const progressLabel = ` ${progressCount}/${PHASE_TOTAL}  ${String(progressPct).padStart(3)}%`;
  const filledCount = Math.round(progressRatio * barWidth);
  const barColored = isColorEnabled()
    ? colorize(bar.slice(0, filledCount), ANSI_CYAN) +
      colorize(bar.slice(filledCount), ANSI_GRAY)
    : bar;
  lines.push(boxLine(barColored + colorize(progressLabel, ANSI_WHITE)));

  // 헤더 라인: projectPath · platform · agent · 총 경과시간
  const elapsed = formatDuration(now - state.sessionStartTime);
  let headerParts = [
    truncate(state.projectPath, Math.max(10, Math.floor(innerWidth * 0.4))),
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
  const headerTruncated = truncate(headerText, innerWidth);
  lines.push(boxLine(colorize(headerTruncated, ANSI_DIM)));

  // 하단 테두리
  const bottomBorder =
    colorize("┗", ANSI_GRAY) +
    colorize("━".repeat(boxWidth - 2), ANSI_GRAY) +
    colorize("┛", ANSI_GRAY);
  lines.push(bottomBorder);

  // ─── 2. 완료된 단계들 — 한 줄에 모아 표시 ─────────────────────

  if (state.completedPhases.length > 0) {
    const completedParts = state.completedPhases.map((phase) => {
      const label = PHASE_LABELS[phase] ?? phase;
      return colorize(`✓ ${label}`, ANSI_GREEN);
    });
    const completedText = completedParts.join("  ");
    const completedStripped = completedParts.map(stripAnsi).join("  ");
    lines.push(" " + (isColorEnabled() ? truncateWithAnsi(completedText, innerWidth) : truncate(completedStripped, innerWidth)));
  }

  // ─── 3. 에러 단계 ─────────────────────────────────────────────

  if (state.errorPhase !== null) {
    const label = PHASE_LABELS[state.errorPhase] ?? state.errorPhase;
    lines.push(" " + colorize(`✗ ${label}`, ANSI_RED));
  }

  // ─── 4. 현재 진행 단계 ────────────────────────────────────────

  if (state.currentPhase !== null) {
    const label = PHASE_LABELS[state.currentPhase] ?? state.currentPhase;
    const phaseElapsed = state.phaseStartTime !== null
      ? formatDuration(now - state.phaseStartTime)
      : "0.0s";
    const spinner = SPINNER_FRAMES[state.spinnerFrame % SPINNER_FRAMES.length];
    // indeterminate: 총 시간을 알 수 없는 단계 — 스피너 + 경과초만
    const currentLine = `▶ ${label} ${colorize(spinner, ANSI_YELLOW)} ${phaseElapsed}`;
    lines.push(" " + currentLine);

    // 빌드 커맨드 요약 (build 단계일 때) — sanitize 후 출력
    if (state.currentPhase === "build" && state.buildCommand !== undefined) {
      const cmdSafe = sanitizeForTerminal(state.buildCommand);
      const cmdText = truncate(cmdSafe, Math.max(10, innerWidth - 4));
      lines.push("   " + colorize(cmdText, ANSI_DIM));
    }
  }

  // ─── 5. 구분선 ────────────────────────────────────────────────

  lines.push(" " + colorize("─".repeat(Math.max(1, termWidth - 3)), ANSI_GRAY));

  // ─── 6. 최근 detail — sanitize 후 출력 ───────────────────────

  if (state.lastDetail !== null) {
    const detailSafe = sanitizeForTerminal(state.lastDetail);
    const detailText = truncate(detailSafe, Math.max(10, termWidth - 10));
    lines.push(" " + colorize("최근: ", ANSI_DIM) + colorize(detailText, ANSI_GRAY));
  }

  return lines;
}

// ─── 내부 헬퍼: ANSI 포함 문자열 truncate ────────────────────────

/**
 * ANSI 코드가 포함된 문자열을 시각적 폭 기준으로 truncate한다.
 * strip 후 길이로 판단하고, 너무 길면 앞부분만 남긴다.
 */
function truncateWithAnsi(text: string, maxVisibleLen: number): string {
  const stripped = stripAnsi(text);
  if (stripped.length <= maxVisibleLen) return text;
  // 간단하게: strip 후 잘라서 반환 (색상 코드 손실 허용, 안전한 폴백)
  return stripped.slice(0, maxVisibleLen - 1) + "…";
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
  private lastLineCount = 0;
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

    // 커서 숨김
    process.stderr.write("\x1b[?25l");

    // SIGINT 훅은 stop()에서 복원 — 이 시점에 등록
    process.on("SIGINT", this._onSigint);

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
    process.removeListener("SIGINT", this._onSigint);
    if (this.isLive) {
      // 커서 복원
      process.stderr.write("\x1b[?25h");
    }
  }

  private readonly _onSigint = (): void => {
    this._cleanup();
    process.exit(130); // 128 + SIGINT(2)
  };

  private _render(): void {
    if (!this.isLive) return;

    const termWidth = process.stderr.columns || 80;
    const now = Date.now();
    const lines = renderDashboard(this.state, termWidth, now);

    // 직전 라인을 덮어쓰기: 커서를 위로 올리고 지운다
    if (this.lastLineCount > 0) {
      process.stderr.write(
        `\x1b[${this.lastLineCount}A` + // 위로 이동
        "\x1b[0J",                        // 아래 전체 지우기
      );
    }

    process.stderr.write(lines.join("\n") + "\n");
    this.lastLineCount = lines.length;
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
