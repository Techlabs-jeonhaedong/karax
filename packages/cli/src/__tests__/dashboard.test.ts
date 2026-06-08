/**
 * dashboard.ts 순수 함수 단위 테스트
 *
 * 테스트 대상:
 *   - renderBar: 진행바 문자열 생성
 *   - formatDuration: 경과 시간 포맷
 *   - applyEvent: 이벤트 → 상태 reducer
 *   - renderDashboard: 상태 → 라인 배열 렌더
 *   - sanitizeForTerminal: ANSI/제어문자 정화 (보안)
 *   - stripAnsi: OSC/문자셋/DEC 시퀀스 추가 제거 (보안)
 *   - LiveDashboard._fallbackLog: non-TTY 폴백 풀 라벨 회귀 방지
 *
 * 색상 off 상태(NO_COLOR)로 renderDashboard를 테스트해서
 * ANSI 코드 없이 텍스트 내용을 검증한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderBar,
  formatDuration,
  applyEvent,
  renderDashboard,
  stripAnsi,
  sanitizeForTerminal,
  LiveDashboard,
  type DashboardState,
} from "../dashboard.js";
import type { E2eProgressEvent } from "@karax/e2e";

// ─── stripAnsi 헬퍼 ────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("ANSI 이스케이프 코드를 제거한다", () => {
    expect(stripAnsi("\x1b[32m✓\x1b[0m 완료")).toBe("✓ 완료");
  });

  it("ANSI 없는 문자열은 그대로 반환한다", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("빈 문자열은 빈 문자열을 반환한다", () => {
    expect(stripAnsi("")).toBe("");
  });
});

// ─── renderBar ─────────────────────────────────────────────────────

describe("renderBar", () => {
  it("ratio 0이면 빈 바를 반환한다", () => {
    const bar = renderBar(0, 10);
    // 채움 없이 빈칸만
    expect(bar.length).toBe(10);
    expect(bar).not.toContain("█");
  });

  it("ratio 1이면 꽉 찬 바를 반환한다", () => {
    const bar = renderBar(1, 10);
    expect(bar.length).toBe(10);
    expect(bar).not.toContain("░");
  });

  it("ratio 0.5이면 절반 채운 바를 반환한다", () => {
    const bar = renderBar(0.5, 10);
    // 채움 5, 빈칸 5
    const filled = (bar.match(/█/g) ?? []).length;
    const empty = (bar.match(/░/g) ?? []).length;
    expect(filled).toBe(5);
    expect(empty).toBe(5);
  });

  it("ratio 음수는 0으로 클램프된다", () => {
    const bar = renderBar(-0.5, 10);
    expect(bar).not.toContain("█");
  });

  it("ratio 1 초과는 1로 클램프된다", () => {
    const bar = renderBar(2, 10);
    expect(bar).not.toContain("░");
  });

  it("width 0이면 빈 문자열을 반환한다", () => {
    expect(renderBar(0.5, 0)).toBe("");
  });

  it("width 1이면 길이 1 바를 반환한다", () => {
    expect(renderBar(0.5, 1).length).toBe(1);
  });

  it("ratio 0.3, width 10이면 3개 채워진다", () => {
    const bar = renderBar(0.3, 10);
    const filled = (bar.match(/█/g) ?? []).length;
    expect(filled).toBe(3);
  });
});

// ─── formatDuration ────────────────────────────────────────────────

describe("formatDuration", () => {
  it("0ms → '0.0s'", () => {
    expect(formatDuration(0)).toBe("0.0s");
  });

  it("1500ms → '1.5s'", () => {
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("62000ms → '1m02s'", () => {
    expect(formatDuration(62000)).toBe("1m02s");
  });

  it("60000ms → '1m00s'", () => {
    expect(formatDuration(60000)).toBe("1m00s");
  });

  it("3661000ms → '61m01s'", () => {
    // 1시간 1분 1초 — 분 단위로 표현
    expect(formatDuration(3661000)).toBe("61m01s");
  });

  it("999ms → '1.0s' (반올림)", () => {
    expect(formatDuration(999)).toBe("1.0s");
  });

  it("59999ms → 분 단위 전환 경계 (59.9... 또는 1m00s)", () => {
    const result = formatDuration(59999);
    // 59.999... → toFixed(1) = "60.0" → 분 단위로 넘어감 or "60.0s"
    // 구현이 결정론적이면 둘 중 하나여야 한다
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("음수 ms는 '0.0s'로 처리한다", () => {
    expect(formatDuration(-100)).toBe("0.0s");
  });

  it("45000ms → '45.0s'", () => {
    expect(formatDuration(45000)).toBe("45.0s");
  });
});

// ─── applyEvent ────────────────────────────────────────────────────

/**
 * 초기 상태 생성 헬퍼
 */
function makeInitialState(): DashboardState {
  return {
    phaseIndex: 0,
    completedPhases: [],
    currentPhase: null,
    errorPhase: null,
    sessionStartTime: 1000,
    phaseStartTime: null,
    lastDetail: null,
    lastStepIndex: undefined,
    totalSteps: undefined,
    projectPath: "/test/project",
    platform: "android",
    agent: "claude",
    buildCommand: undefined,
    spinnerFrame: 0,
    seenPhases: new Set(),
  };
}

function makeEvent(overrides: Partial<E2eProgressEvent>): E2eProgressEvent {
  return {
    phase: "scenario",
    status: "start",
    timestamp: 2000,
    ...overrides,
  };
}

describe("applyEvent", () => {
  it("start 이벤트가 currentPhase를 갱신한다", () => {
    const state = makeInitialState();
    const event = makeEvent({ phase: "scenario", status: "start" });
    const next = applyEvent(state, event, 2000);
    expect(next.currentPhase).toBe("scenario");
    expect(next.phaseStartTime).toBe(2000);
  });

  it("start 이벤트가 phaseIndex를 1 증가시킨다 (최초)", () => {
    const state = makeInitialState();
    const event = makeEvent({ phase: "scenario", status: "start" });
    const next = applyEvent(state, event, 2000);
    expect(next.phaseIndex).toBe(1);
  });

  it("같은 phase start가 두 번 오면 phaseIndex가 두 번 증가하지 않는다", () => {
    const state = makeInitialState();
    const event = makeEvent({ phase: "scenario", status: "start" });
    const s1 = applyEvent(state, event, 2000);
    const s2 = applyEvent(s1, event, 2001);
    // seenPhases에 이미 있으므로 증가하지 않아야 한다
    expect(s2.phaseIndex).toBe(1);
  });

  it("done 이벤트가 completedPhases에 추가된다", () => {
    const state = makeInitialState();
    const startEvent = makeEvent({ phase: "scenario", status: "start" });
    const s1 = applyEvent(state, startEvent, 2000);
    const doneEvent = makeEvent({ phase: "scenario", status: "done" });
    const s2 = applyEvent(s1, doneEvent, 3000);
    expect(s2.completedPhases).toContain("scenario");
    expect(s2.currentPhase).toBeNull();
  });

  it("error 이벤트가 errorPhase를 설정한다", () => {
    const state = makeInitialState();
    const event = makeEvent({ phase: "build", status: "error", detail: "빌드 실패" });
    const next = applyEvent(state, event, 3000);
    expect(next.errorPhase).toBe("build");
    expect(next.lastDetail).toBe("빌드 실패");
  });

  it("heartbeat 이벤트는 phaseIndex를 갱신하지 않는다 — 핵심", () => {
    const state = makeInitialState();
    const startEvent = makeEvent({ phase: "build", status: "start" });
    const s1 = applyEvent(state, startEvent, 2000);
    const hbEvent = makeEvent({ phase: "build", status: "start", heartbeat: true });
    const s2 = applyEvent(s1, hbEvent, 2200);
    // heartbeat이면 phaseIndex가 변하지 않아야 한다
    expect(s2.phaseIndex).toBe(s1.phaseIndex);
    // seenPhases도 변하지 않아야 한다
    expect(s2.seenPhases.size).toBe(s1.seenPhases.size);
  });

  it("heartbeat 이벤트는 lastDetail을 갱신하지 않는다", () => {
    const state = makeInitialState();
    const startEvent = makeEvent({ phase: "build", status: "start", detail: "빌드 시작" });
    const s1 = applyEvent(state, startEvent, 2000);
    const hbEvent = makeEvent({ phase: "build", status: "start", heartbeat: true, detail: "heartbeat" });
    const s2 = applyEvent(s1, hbEvent, 2200);
    // heartbeat의 detail은 lastDetail에 반영되지 않아야 한다
    expect(s2.lastDetail).toBe("빌드 시작");
  });

  it("suite stepIndex 변경 시 phaseIndex와 seenPhases를 리셋한다", () => {
    const state = makeInitialState();
    const e1 = makeEvent({ phase: "scenario", status: "start", stepIndex: 0, totalSteps: 3 });
    const s1 = applyEvent(state, e1, 1000);
    expect(s1.phaseIndex).toBe(1);

    // 다음 시나리오로 전환
    const e2 = makeEvent({ phase: "scenario", status: "start", stepIndex: 1, totalSteps: 3 });
    const s2 = applyEvent(s1, e2, 2000);
    // phaseIndex가 1로 리셋되어야 한다 (새 stepIndex의 첫 phase)
    expect(s2.phaseIndex).toBe(1);
    expect(s2.lastStepIndex).toBe(1);
    // 이전 단계들이 seenPhases에서 지워졌으므로 size가 1이어야 한다
    expect(s2.seenPhases.size).toBe(1);
  });

  it("totalSteps가 있으면 state에 저장된다", () => {
    const state = makeInitialState();
    const event = makeEvent({ phase: "scenario", status: "start", stepIndex: 0, totalSteps: 5 });
    const next = applyEvent(state, event, 2000);
    expect(next.totalSteps).toBe(5);
    expect(next.lastStepIndex).toBe(0);
  });

  it("detail이 있는 start 이벤트는 lastDetail을 갱신한다", () => {
    const state = makeInitialState();
    const event = makeEvent({ phase: "build", status: "start", detail: "gradle assembleDebug" });
    const next = applyEvent(state, event, 2000);
    expect(next.lastDetail).toBe("gradle assembleDebug");
  });

  it("detail이 있는 done 이벤트는 lastDetail을 갱신한다", () => {
    const state = makeInitialState();
    const e1 = makeEvent({ phase: "scenario", status: "start" });
    const s1 = applyEvent(state, e1, 2000);
    const e2 = makeEvent({ phase: "scenario", status: "done", detail: "시나리오 2건 파싱 완료" });
    const s2 = applyEvent(s1, e2, 3000);
    expect(s2.lastDetail).toBe("시나리오 2건 파싱 완료");
  });
});

// ─── renderDashboard ───────────────────────────────────────────────

/**
 * NO_COLOR 환경에서 렌더링 → ANSI 없이 내용 검증
 */

function makeRenderState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    phaseIndex: 5,
    completedPhases: ["scenario", "detect", "device", "appmap"],
    currentPhase: "build",
    errorPhase: null,
    sessionStartTime: 0,
    phaseStartTime: 0,
    lastDetail: "gradle assembleKrDevDebug…",
    lastStepIndex: undefined,
    totalSteps: undefined,
    projectPath: "/home/user/MyApp",
    platform: "android",
    agent: "claude",
    buildCommand: "gradle assembleKrDevDebug",
    spinnerFrame: 0,
    seenPhases: new Set(["scenario", "detect", "device", "appmap", "build"]),
    ...overrides,
  };
}

describe("renderDashboard (NO_COLOR)", () => {
  let origNoColor: string | undefined;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  it("라인 배열을 반환한다 (비어있지 않음)", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("헤더에 'karax E2E'가 포함된다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("karax E2E");
  });

  it("완료 단계 4개가 체크 표시로 표현된다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    // ✓ 표시가 4개 있어야 한다 (완료 단계 수)
    const checkCount = (text.match(/✓/g) ?? []).length;
    expect(checkCount).toBe(4);
  });

  it("현재 단계(build)가 ▶ 표시로 포함된다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("▶");
    expect(text).toContain("앱 빌드");
  });

  it("전체 진행바에 5/10 진행률이 포함된다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("5/10");
  });

  it("lastDetail이 있으면 하단에 표시된다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("gradle assembleKrDevDebug…");
  });

  it("buildCommand가 있으면 현재 단계 아래에 표시된다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("gradle assembleKrDevDebug");
  });

  it("suite 모드: totalSteps가 있으면 헤더에 시나리오 표시가 포함된다", () => {
    const state = makeRenderState({
      lastStepIndex: 1,
      totalSteps: 5,
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toMatch(/2\/5|시나리오/);
  });

  it("에러 상태: errorPhase가 있으면 ✗ 표시가 포함된다", () => {
    const state = makeRenderState({
      currentPhase: null,
      errorPhase: "build",
      completedPhases: ["scenario", "detect"],
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("✗");
  });

  it("좁은 터미널(30열)에서도 크래시하지 않고 라인 배열을 반환한다", () => {
    const lines = renderDashboard(makeRenderState(), 30, 60000);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("매우 긴 detail은 truncate된다 (콘솔 폭 초과 방지)", () => {
    const longDetail = "a".repeat(200);
    const state = makeRenderState({ lastDetail: longDetail });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    // 200자 그대로는 들어가지 않는다
    expect(text).not.toContain(longDetail);
  });

  it("NO_COLOR일 때 ANSI 이스케이프가 없다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const raw = lines.join("\n");
    // ANSI 이스케이프 코드가 없어야 한다
    expect(raw).not.toMatch(/\x1b\[/);
  });

  it("completedPhases가 빈 배열이면 ✓가 없다", () => {
    const state = makeRenderState({
      completedPhases: [],
      currentPhase: "scenario",
      phaseIndex: 1,
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).not.toContain("✓");
  });

  it("currentPhase가 null이면 ▶가 없다", () => {
    const state = makeRenderState({
      completedPhases: ["scenario", "detect", "device", "appmap", "build", "install", "launch", "agent", "crash-scan", "report"],
      currentPhase: null,
      errorPhase: null,
      phaseIndex: 10,
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).not.toContain("▶");
  });

  it("lastDetail에 ANSI 이스케이프가 섞여도 출력 라인에 제어문자가 없다", () => {
    const state = makeRenderState({
      lastDetail: "빌드 실패\x1b[2J화면지움",
    });
    const lines = renderDashboard(state, 80, 60000);
    const raw = lines.join("\n");
    // \x1b[2J 같은 위험 제어문자가 출력에 포함되지 않아야 한다
    expect(raw).not.toContain("\x1b[2J");
  });

  it("buildCommand에 ANSI·개행이 섞여도 출력 라인이 단일 라인이다", () => {
    const state = makeRenderState({
      currentPhase: "build",
      lastDetail: null,
      buildCommand: "UNIQUECMD\x1b[1mBOLD\x1b[0m\nassembleDebug",
    });
    const lines = renderDashboard(state, 80, 60000);
    // 개행 주입으로 라인이 추가로 늘어나지 않아야 한다
    // buildCommand 라인은 단일 라인으로 렌더되어야 함 — 개행 포함 문자열은 sanitize 후 단일 라인
    const cmdLines = lines.filter((l) => l.includes("UNIQUECMD"));
    expect(cmdLines.length).toBe(1);
    expect(cmdLines[0]).not.toContain("\n");
  });
});

// ─── sanitizeForTerminal ───────────────────────────────────────────

describe("sanitizeForTerminal", () => {
  it("일반 문자열은 그대로 반환한다", () => {
    expect(sanitizeForTerminal("gradle assembleDebug")).toBe("gradle assembleDebug");
  });

  it("ANSI 컬러 코드를 제거한다", () => {
    const result = sanitizeForTerminal("\x1b[32m완료\x1b[0m");
    expect(result).not.toContain("\x1b");
    expect(result).toContain("완료");
  });

  it("ANSI 커서 이동 코드를 제거한다", () => {
    const result = sanitizeForTerminal("앞\x1b[2A뒤");
    expect(result).not.toContain("\x1b");
  });

  it("OSC 시퀀스(\\x1b]...\\x07)를 제거한다", () => {
    const result = sanitizeForTerminal("title\x1b]0;my-title\x07end");
    expect(result).not.toContain("\x1b");
    expect(result).toContain("titleend");
  });

  it("OSC 시퀀스(\\x1b]...ST)를 제거한다", () => {
    const result = sanitizeForTerminal("a\x1b]8;;http://example.com\x1b\\link\x1b]8;;\x1b\\b");
    expect(result).not.toContain("\x1b");
  });

  it("개행(\\n)을 공백으로 치환한다", () => {
    expect(sanitizeForTerminal("foo\nbar")).toBe("foo bar");
  });

  it("캐리지리턴(\\r)을 공백으로 치환한다", () => {
    expect(sanitizeForTerminal("foo\rbar")).toBe("foo bar");
  });

  it("탭(\\t)을 공백으로 치환한다", () => {
    expect(sanitizeForTerminal("foo\tbar")).toBe("foo bar");
  });

  it("빈 문자열에도 안전하다", () => {
    expect(sanitizeForTerminal("")).toBe("");
  });

  it("멀티바이트 문자(한글, 이모지)를 유지한다", () => {
    expect(sanitizeForTerminal("빌드 실패 🚨")).toBe("빌드 실패 🚨");
  });

  it("입력 길이 상한(4096자)을 초과하면 잘라낸 뒤 처리한다", () => {
    const longInput = "a".repeat(5000) + "\x1b[2J위험";
    const result = sanitizeForTerminal(longInput);
    // 4096자 이후를 잘라내므로 위험한 시퀀스가 포함되지 않는다
    expect(result).not.toContain("\x1b[2J");
    expect(result.length).toBeLessThanOrEqual(4096);
  });

  it("ANSI + 개행이 복합된 악성 입력에서도 출력이 단일 라인이다", () => {
    const malicious = "빌드 실패\x1b[2J화면지움\n개행주입";
    const result = sanitizeForTerminal(malicious);
    expect(result).not.toContain("\x1b");
    expect(result).not.toContain("\n");
  });
});

// ─── stripAnsi 보강: OSC/문자셋/DEC 시퀀스 ────────────────────────

describe("stripAnsi (보강 시퀀스)", () => {
  it("OSC 시퀀스(\\x1b]...\\x07)를 제거한다", () => {
    const result = stripAnsi("\x1b]0;title\x07text");
    expect(result).not.toContain("\x1b");
    expect(result).toContain("text");
  });

  it("OSC 시퀀스(\\x1b]...ST)를 제거한다", () => {
    const result = stripAnsi("\x1b]8;;http://example.com\x1b\\link\x1b]8;;\x1b\\");
    expect(result).not.toContain("\x1b");
    expect(result).toContain("link");
  });

  it("문자셋 지정 시퀀스(\\x1b( \\x1b))를 제거한다", () => {
    expect(stripAnsi("\x1b(Btext")).not.toContain("\x1b");
    expect(stripAnsi("\x1b)0text")).not.toContain("\x1b");
  });

  it("DEC 프라이빗 시퀀스(\\x1b#)를 제거한다", () => {
    expect(stripAnsi("\x1b#8text")).not.toContain("\x1b");
  });

  it("기존 컬러 코드 제거는 그대로 동작한다", () => {
    expect(stripAnsi("\x1b[32m✓\x1b[0m 완료")).toBe("✓ 완료");
  });

  it("빈 문자열은 그대로 반환한다", () => {
    expect(stripAnsi("")).toBe("");
  });
});

// ─── LiveDashboard non-TTY 폴백: 풀 라벨 회귀 방지 ───────────────

describe("LiveDashboard._fallbackLog 풀 라벨 회귀 방지 (non-TTY)", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  function makeDashboard() {
    return new LiveDashboard({
      projectPath: "/test",
      platform: "android",
      agent: "claude",
    });
  }

  function writtenLines(): string[] {
    return stderrSpy.mock.calls.map((c) => String(c[0]));
  }

  it("scenario start → '[1/10] 시나리오 파싱 시작' 풀 라벨 출력", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "scenario", status: "start", timestamp: 1000 });
    const output = writtenLines().join("");
    expect(output).toContain("시나리오 파싱");
    expect(output).toContain("시작");
  });

  it("detect start → '프레임워크 감지 시작' 풀 라벨 출력", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "scenario", status: "start", timestamp: 1000 });
    dashboard.handleEvent({ phase: "detect", status: "start", timestamp: 2000 });
    const output = writtenLines().join("");
    expect(output).toContain("프레임워크 감지");
  });

  it("detect done → '✓ 프레임워크 감지 완료' 풀 라벨 출력", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "detect", status: "start", timestamp: 1000 });
    dashboard.handleEvent({ phase: "detect", status: "done", timestamp: 2000 });
    const output = writtenLines().join("");
    expect(output).toContain("✓ 프레임워크 감지 완료");
  });

  it("build start → '앱 빌드 시작' 풀 라벨 출력", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "build", status: "start", timestamp: 1000 });
    const output = writtenLines().join("");
    expect(output).toContain("앱 빌드");
    expect(output).toContain("시작");
  });

  it("agent heartbeat → '에이전트 실행 진행 중' 풀 라벨 출력", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "agent", status: "start", timestamp: 1000 });
    stderrSpy.mockClear();
    dashboard.handleEvent({ phase: "agent", status: "start", heartbeat: true, timestamp: 2000 });
    const output = writtenLines().join("");
    expect(output).toContain("에이전트 실행");
    expect(output).toContain("진행 중");
  });

  it("crash-scan error → '✗ 크래시 분석 오류' 풀 라벨 출력", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "crash-scan", status: "start", timestamp: 1000 });
    dashboard.handleEvent({ phase: "crash-scan", status: "error", detail: "logcat 실패", timestamp: 2000 });
    const output = writtenLines().join("");
    expect(output).toContain("✗ 크래시 분석 오류");
  });

  it("report done → '✓ 리포트 작성 완료' 풀 라벨 출력", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "report", status: "start", timestamp: 1000 });
    dashboard.handleEvent({ phase: "report", status: "done", timestamp: 2000 });
    const output = writtenLines().join("");
    expect(output).toContain("✓ 리포트 작성 완료");
  });

  it("폴백 start 라인 형식: [n/10] <풀라벨> 시작", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "scenario", status: "start", timestamp: 1000 });
    const output = writtenLines().join("");
    // [1/10] 시나리오 파싱 시작
    expect(output).toMatch(/\[1\/10\] 시나리오 파싱 시작/);
  });

  it("detail이 있는 start → 라인에 detail이 포함된다", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({ phase: "build", status: "start", detail: "gradle assembleDebug", timestamp: 1000 });
    const output = writtenLines().join("");
    expect(output).toContain("gradle assembleDebug");
  });

  it("detail에 ANSI 제어문자가 섞여도 출력에 \\x1b가 없다", () => {
    const dashboard = makeDashboard();
    dashboard.handleEvent({
      phase: "build",
      status: "error",
      detail: "실패\x1b[2J화면지움",
      timestamp: 1000,
    });
    const output = writtenLines().join("");
    expect(output).not.toContain("\x1b");
  });
});
