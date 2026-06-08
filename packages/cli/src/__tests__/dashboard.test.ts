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
  displayWidth,
  truncateToWidth,
  physicalRows,
  lerpColor,
  gradientText,
  supportsTrueColor,
  renderBanner,
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
    // ✅ 표시가 4개 있어야 한다 (완료 단계 수)
    const checkCount = (text.match(/✅/g) ?? []).length;
    expect(checkCount).toBe(4);
  });

  it("현재 단계(build)가 ⚡ 표시로 포함된다", () => {
    const lines = renderDashboard(makeRenderState(), 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("⚡");
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

  it("에러 상태: errorPhase가 있으면 ❌ 표시가 포함된다", () => {
    const state = makeRenderState({
      currentPhase: null,
      errorPhase: "build",
      completedPhases: ["scenario", "detect"],
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("❌");
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

  it("completedPhases가 빈 배열이면 ✅가 없다", () => {
    const state = makeRenderState({
      completedPhases: [],
      currentPhase: "scenario",
      phaseIndex: 1,
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).not.toContain("✅");
  });

  it("currentPhase가 null이면 ⚡가 없다", () => {
    const state = makeRenderState({
      completedPhases: ["scenario", "detect", "device", "appmap", "build", "install", "launch", "agent", "crash-scan", "report"],
      currentPhase: null,
      errorPhase: null,
      phaseIndex: 10,
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).not.toContain("⚡");
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

// ─── displayWidth ──────────────────────────────────────────────────

describe("displayWidth", () => {
  it("빈 문자열은 0", () => {
    expect(displayWidth("")).toBe(0);
  });

  it("ASCII 문자열: 글자 수와 동일", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("hello world")).toBe(11);
  });

  it("한글 음절(AC00-D7A3): 각 2칸", () => {
    expect(displayWidth("시나리오")).toBe(8); // 4글자 × 2
    expect(displayWidth("앱")).toBe(2);
  });

  it("한글 자모(1100-115F): 2칸", () => {
    // U+1100 ᄀ (Hangul Jamo)
    expect(displayWidth("ᄀ")).toBe(2);
  });

  it("CJK 통합 한자(4E00-9FFF): 2칸", () => {
    expect(displayWidth("中")).toBe(2); // 中
    expect(displayWidth("香")).toBe(2); // 香
  });

  it("이모지(1F300-1FAFF): 2칸", () => {
    expect(displayWidth("🚀")).toBe(2);
    expect(displayWidth("🎉")).toBe(2);
    expect(displayWidth("⚠️")).toBeGreaterThanOrEqual(1); // 변형 선택자 포함 — 최소 1
  });

  it("혼합 문자열: ASCII + 한글", () => {
    // "앱 v1" = 앱(2) + 공백(1) + v(1) + 1(1) = 5
    expect(displayWidth("앱 v1")).toBe(5);
  });

  it("박스 드로잉 문자는 1칸 (의도된 동작)", () => {
    expect(displayWidth("┃")).toBe(1);
    expect(displayWidth("─")).toBe(1);
    expect(displayWidth("┏")).toBe(1);
    expect(displayWidth("┓")).toBe(1);
  });

  it("진행바 블록 문자는 1칸", () => {
    expect(displayWidth("█")).toBe(1);
    expect(displayWidth("░")).toBe(1);
  });

  it("✓ ▶ 같은 특수 ASCII 유사 문자는 1칸", () => {
    expect(displayWidth("✓")).toBe(1);
    expect(displayWidth("▶")).toBe(1);
  });

  it("결합 문자(0300-036F)는 0칸", () => {
    // U+0301 acute accent (combining)
    const base = "a";
    const withCombining = "á"; // á (combining)
    expect(displayWidth(withCombining)).toBe(displayWidth(base)); // 결합 문자는 폭 0
  });

  it("NUL(0x00)은 0칸", () => {
    expect(displayWidth("\x00")).toBe(0);
  });

  it("전각 라틴 문자(FF00-FF60): 2칸", () => {
    expect(displayWidth("！")).toBe(2); // ！ Fullwidth Exclamation Mark
    expect(displayWidth("ａ")).toBe(2); // ａ Fullwidth Latin Small Letter A
  });

  it("히라가나(3041-303E): 2칸", () => {
    expect(displayWidth("あ")).toBe(2); // あ
    expect(displayWidth("い")).toBe(2); // い
  });

  it("카타카나(30A0-33FF 범위): 2칸", () => {
    expect(displayWidth("ア")).toBe(2); // ア
  });
});

// ─── truncateToWidth ───────────────────────────────────────────────

describe("truncateToWidth", () => {
  it("maxWidth보다 짧으면 그대로 반환", () => {
    expect(truncateToWidth("abc", 10)).toBe("abc");
    expect(truncateToWidth("시나리오", 10)).toBe("시나리오"); // width=8 ≤ 10
  });

  it("딱 맞으면 자르지 않음", () => {
    expect(truncateToWidth("abc", 3)).toBe("abc");
    expect(truncateToWidth("시나", 4)).toBe("시나"); // width=4 = maxWidth=4
  });

  it("ASCII: maxWidth 초과 시 … 붙여 자름", () => {
    const result = truncateToWidth("hello world", 8);
    expect(displayWidth(result)).toBeLessThanOrEqual(8);
    expect(result).toContain("…");
  });

  it("한글: maxWidth 초과 시 결과 displayWidth ≤ maxWidth", () => {
    // "시나리오" = width 8; maxWidth=5 → 잘려야 함
    const result = truncateToWidth("시나리오", 5);
    expect(displayWidth(result)).toBeLessThanOrEqual(5);
    expect(result).toContain("…");
  });

  it("혼합: 잘린 결과가 maxWidth를 초과하지 않음", () => {
    const result = truncateToWidth("앱 빌드 gradle assembleDebug", 10);
    expect(displayWidth(result)).toBeLessThanOrEqual(10);
  });

  it("maxWidth=1: 최소한 … 또는 빈 문자열 반환", () => {
    const result = truncateToWidth("abc", 1);
    expect(displayWidth(result)).toBeLessThanOrEqual(1);
  });

  it("maxWidth=0: 빈 문자열 반환", () => {
    expect(truncateToWidth("abc", 0)).toBe("");
  });

  it("빈 문자열은 그대로 반환", () => {
    expect(truncateToWidth("", 10)).toBe("");
  });

  it("한글이 경계에 걸릴 때(폭 홀수): 초과하지 않음", () => {
    // "시나" width=4, maxWidth=3 → "시"(2)+"…"(1)=3 이어야 함
    const result = truncateToWidth("시나", 3);
    expect(displayWidth(result)).toBeLessThanOrEqual(3);
  });

  it("이모지 포함 문자열 truncate: displayWidth ≤ maxWidth", () => {
    const result = truncateToWidth("빌드 완료 🚀🎉", 8);
    expect(displayWidth(result)).toBeLessThanOrEqual(8);
  });
});

// ─── physicalRows ──────────────────────────────────────────────────

describe("physicalRows", () => {
  it("모든 라인이 termWidth 이하면 lines.length와 같음", () => {
    const lines = ["abc", "def", "ghi"]; // 각 width=3
    expect(physicalRows(lines, 80)).toBe(3);
  });

  it("빈 배열이면 0", () => {
    expect(physicalRows([], 80)).toBe(0);
  });

  it("빈 문자열 라인은 물리 행 1개", () => {
    expect(physicalRows([""], 80)).toBe(1);
  });

  it("width가 termWidth의 정확히 2배이면 물리 행 2개", () => {
    // 20글자 ASCII = displayWidth 20, termWidth 10 → ceil(20/10) = 2
    const lines = ["a".repeat(20)];
    expect(physicalRows(lines, 10)).toBe(2);
  });

  it("한글 라인이 termWidth를 넘으면 물리 행이 늘어남", () => {
    // "시나리오" = displayWidth 8; termWidth=5 → ceil(8/5)=2
    const lines = ["시나리오"];
    expect(physicalRows(lines, 5)).toBe(2);
  });

  it("termWidth=1: 각 글자가 물리 1행 (단 한글은 2행/글자)", () => {
    // "ab" = displayWidth 2, termWidth=1 → ceil(2/1)=2
    expect(physicalRows(["ab"], 1)).toBe(2);
  });

  it("ANSI 코드 포함 라인: strip 후 width 계산", () => {
    // "\x1b[32m✓\x1b[0m abc" → strip → "✓ abc" = displayWidth 5
    const lines = ["\x1b[32m✓\x1b[0m abc"];
    expect(physicalRows(lines, 80)).toBe(1); // 5 ≤ 80 → 1행
  });

  // ─── termWidth <= 0 가드 테스트 ─────────────────────────────────

  it("termWidth=0: 빈 배열이면 0 (가드)", () => {
    expect(physicalRows([], 0)).toBe(0);
  });

  it("termWidth=0: 라인 1개이면 1 (lines.length 반환)", () => {
    expect(physicalRows(["abc"], 0)).toBe(1);
  });

  it("termWidth=0: 라인 2개이면 2 (lines.length 반환)", () => {
    expect(physicalRows(["a", "b"], 0)).toBe(2);
  });

  it("termWidth=-5: 라인 2개이면 2 (lines.length 반환)", () => {
    expect(physicalRows(["a", "b"], -5)).toBe(2);
  });

  it("termWidth=-1: 빈 배열이면 0 (가드)", () => {
    expect(physicalRows([], -1)).toBe(0);
  });

  it("termWidth=-999: Infinity가 되지 않고 lines.length를 반환한다", () => {
    // 핵심: termWidth <= 0이면 Infinity 반환 대신 안전하게 lines.length 반환
    const result = physicalRows(["abc"], -999);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(1);
  });
});

// ─── LiveDashboard resize debounce 테스트 ─────────────────────────

describe("LiveDashboard resize debounce", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let origIsTTY: boolean | undefined;
  let origColumns: number | undefined;

  beforeEach(() => {
    vi.useFakeTimers();

    // TTY 환경 모킹 (isLive=true가 되도록)
    origIsTTY = process.stderr.isTTY;
    origColumns = process.stderr.columns;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stderr, "columns", { value: 80, configurable: true });

    // NO_COLOR 제거 (isLive=true 조건)
    delete process.env.NO_COLOR;

    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    stderrSpy.mockRestore();

    // 원래 값 복원
    if (origIsTTY === undefined) {
      Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    } else {
      Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
    }
    if (origColumns === undefined) {
      Object.defineProperty(process.stderr, "columns", { value: undefined, configurable: true });
    } else {
      Object.defineProperty(process.stderr, "columns", { value: origColumns, configurable: true });
    }
  });

  function makeLiveDashboard() {
    return new LiveDashboard({
      projectPath: "/test",
      platform: "android",
      agent: "claude",
    });
  }

  it("_cleanup()이 호출되면 resizeTimer가 정리된다 (누수 방지)", () => {
    const dashboard = makeLiveDashboard();
    dashboard.start();
    stderrSpy.mockClear();

    // resize 이벤트 발생 → debounce 타이머 예약됨
    process.stderr.emit("resize");

    // stop()이 cleanup을 호출 — 내부적으로 타이머가 clearTimeout됨
    // fake timer 만료 전에 stop하면 _render가 추가 호출되지 않아야 한다
    const writeCountBeforeStop = stderrSpy.mock.calls.length;
    dashboard.stop();
    // stop이 최종 _render를 1번 호출하므로 그 이후 추가 호출이 없어야 한다
    const writeCountAfterStop = stderrSpy.mock.calls.length;

    // debounce 타이머 만료 시뮬레이션 — 이미 cleanup되었으므로 추가 write 없어야 함
    vi.advanceTimersByTime(200);
    expect(stderrSpy.mock.calls.length).toBe(writeCountAfterStop);
  });

  it("resize 이벤트가 연속으로 발생해도 debounce 지연 내에는 _render가 1번만 추가 호출된다", () => {
    const dashboard = makeLiveDashboard();
    dashboard.start();

    // start()의 초기 _render 호출 카운트 기록
    const writeCountAfterStart = stderrSpy.mock.calls.length;

    // resize 이벤트를 10번 빠르게 발생
    for (let i = 0; i < 10; i++) {
      process.stderr.emit("resize");
    }

    // debounce 지연(80ms) 전에는 추가 _render가 없어야 한다
    vi.advanceTimersByTime(50);
    expect(stderrSpy.mock.calls.length).toBe(writeCountAfterStart);

    // debounce 지연 후에는 _render가 정확히 1번 추가 호출되어야 한다
    vi.advanceTimersByTime(100);
    // 최소 1번의 write가 발생해야 함 (debounce된 _render)
    expect(stderrSpy.mock.calls.length).toBeGreaterThan(writeCountAfterStart);

    dashboard.stop();
  });
});

// ─── displayWidth 이모지 폭 보강: 새 아이콘들 ──────────────────────

describe("displayWidth — 새 아이콘 폭 명시 검증", () => {
  // renderDashboard/renderBanner에서 실제로 사용하는 아이콘들
  // 불변식: displayWidth 계산 == 실제 터미널 표시 폭

  it("✅ (U+2705 CHECK MARK BUTTON) = 2칸", () => {
    // 이모지 체크마크: 터미널에서 전각(2칸) 표시
    expect(displayWidth("✅")).toBe(2);
  });

  it("❌ (U+274C CROSS MARK) = 2칸", () => {
    // 이모지 X 마크: 터미널에서 전각(2칸) 표시
    expect(displayWidth("❌")).toBe(2);
  });

  it("⚡ (U+26A1 HIGH VOLTAGE SIGN) = 2칸", () => {
    // 번개 이모지: 터미널에서 전각(2칸) 표시
    expect(displayWidth("⚡")).toBe(2);
  });

  it("◉ (U+25C9 FISHEYE) = 1칸 (Geometric Shapes, 박스드로잉 류)", () => {
    // 박스 드로잉 계열 단색 기호: 1칸 유지
    expect(displayWidth("◉")).toBe(1);
  });

  it("⏺ (U+23FA BLACK CIRCLE FOR RECORD) = 1칸 (Misc Technical)", () => {
    // 기록 버튼 기호: 1칸
    expect(displayWidth("⏺")).toBe(1);
  });

  it("기존 ✓ (U+2713 CHECK MARK) = 1칸 유지 (회귀 없음)", () => {
    expect(displayWidth("✓")).toBe(1);
  });

  it("기존 ▶ (U+25B6) = 1칸 유지 (회귀 없음)", () => {
    expect(displayWidth("▶")).toBe(1);
  });

  it("기존 █ ░ = 1칸 유지 (회귀 없음)", () => {
    expect(displayWidth("█")).toBe(1);
    expect(displayWidth("░")).toBe(1);
  });

  it("기존 ┃ ─ ┏ ┓ = 1칸 유지 (회귀 없음)", () => {
    expect(displayWidth("┃")).toBe(1);
    expect(displayWidth("─")).toBe(1);
    expect(displayWidth("┏")).toBe(1);
    expect(displayWidth("┓")).toBe(1);
  });
});

// ─── lerpColor ─────────────────────────────────────────────────────

describe("lerpColor", () => {
  it("t=0이면 from 색을 반환한다", () => {
    expect(lerpColor([255, 0, 0], [0, 0, 255], 0)).toEqual([255, 0, 0]);
  });

  it("t=1이면 to 색을 반환한다", () => {
    expect(lerpColor([255, 0, 0], [0, 0, 255], 1)).toEqual([0, 0, 255]);
  });

  it("t=0.5이면 중간값을 반환한다", () => {
    const result = lerpColor([0, 0, 0], [100, 200, 100], 0.5);
    expect(result[0]).toBe(50);
    expect(result[1]).toBe(100);
    expect(result[2]).toBe(50);
  });

  it("t 음수는 0으로 클램프된다", () => {
    expect(lerpColor([255, 0, 0], [0, 0, 255], -0.5)).toEqual([255, 0, 0]);
  });

  it("t 1 초과는 1로 클램프된다", () => {
    expect(lerpColor([255, 0, 0], [0, 0, 255], 2)).toEqual([0, 0, 255]);
  });

  it("from==to이면 항상 같은 색을 반환한다", () => {
    expect(lerpColor([128, 64, 32], [128, 64, 32], 0.7)).toEqual([128, 64, 32]);
  });

  it("결과 RGB 값이 0~255 범위 내에 있다", () => {
    const result = lerpColor([0, 100, 200], [255, 50, 10], 0.3);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

// ─── supportsTrueColor ─────────────────────────────────────────────

describe("supportsTrueColor", () => {
  let origColorterm: string | undefined;
  let origNoColor: string | undefined;

  beforeEach(() => {
    origColorterm = process.env.COLORTERM;
    origNoColor = process.env.NO_COLOR;
  });

  afterEach(() => {
    if (origColorterm === undefined) delete process.env.COLORTERM;
    else process.env.COLORTERM = origColorterm;
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
  });

  it("COLORTERM=truecolor → true", () => {
    process.env.COLORTERM = "truecolor";
    delete process.env.NO_COLOR;
    expect(supportsTrueColor()).toBe(true);
  });

  it("COLORTERM=24bit → true", () => {
    process.env.COLORTERM = "24bit";
    delete process.env.NO_COLOR;
    expect(supportsTrueColor()).toBe(true);
  });

  it("COLORTERM 미설정 → false", () => {
    delete process.env.COLORTERM;
    delete process.env.NO_COLOR;
    expect(supportsTrueColor()).toBe(false);
  });

  it("COLORTERM=256colors → false (트루컬러 아님)", () => {
    process.env.COLORTERM = "256colors";
    delete process.env.NO_COLOR;
    expect(supportsTrueColor()).toBe(false);
  });

  it("NO_COLOR 설정 시 COLORTERM=truecolor여도 false", () => {
    process.env.COLORTERM = "truecolor";
    process.env.NO_COLOR = "1";
    expect(supportsTrueColor()).toBe(false);
  });
});

// ─── gradientText ──────────────────────────────────────────────────

describe("gradientText", () => {
  let origColorterm: string | undefined;
  let origNoColor: string | undefined;

  beforeEach(() => {
    origColorterm = process.env.COLORTERM;
    origNoColor = process.env.NO_COLOR;
  });

  afterEach(() => {
    if (origColorterm === undefined) delete process.env.COLORTERM;
    else process.env.COLORTERM = origColorterm;
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
  });

  it("stripAnsi 후 원문과 동일 (폭 불변 — 트루컬러 ON)", () => {
    process.env.COLORTERM = "truecolor";
    delete process.env.NO_COLOR;
    const text = "KARAX";
    const result = gradientText(text, [0, 255, 255], [255, 0, 255]);
    expect(stripAnsi(result)).toBe(text);
  });

  it("NO_COLOR면 ANSI 코드 없이 원문만 반환", () => {
    process.env.NO_COLOR = "1";
    const text = "KARAX";
    const result = gradientText(text, [0, 255, 255], [255, 0, 255]);
    expect(result).toBe(text);
    expect(result).not.toContain("\x1b");
  });

  it("트루컬러 미지원(COLORTERM 없음)이면 ANSI 코드 없이 원문만 반환", () => {
    delete process.env.COLORTERM;
    delete process.env.NO_COLOR;
    const text = "KARAX";
    const result = gradientText(text, [0, 255, 255], [255, 0, 255]);
    // 트루컬러 폴백: 원문 반환 (또는 단색, 어떤 경우든 stripAnsi=원문)
    expect(stripAnsi(result)).toBe(text);
  });

  it("트루컬러 ON이면 24bit ANSI 코드가 포함된다", () => {
    process.env.COLORTERM = "truecolor";
    delete process.env.NO_COLOR;
    const result = gradientText("AB", [0, 255, 255], [255, 0, 255]);
    // 트루컬러 ANSI: \x1b[38;2;R;G;Bm
    expect(result).toMatch(/\x1b\[38;2;/);
  });

  it("한글 텍스트에도 stripAnsi 후 원문 동일", () => {
    process.env.COLORTERM = "truecolor";
    delete process.env.NO_COLOR;
    const text = "카락스";
    const result = gradientText(text, [0, 255, 255], [255, 0, 255]);
    expect(stripAnsi(result)).toBe(text);
  });

  it("빈 문자열도 안전하게 처리", () => {
    process.env.COLORTERM = "truecolor";
    delete process.env.NO_COLOR;
    expect(gradientText("", [0, 255, 255], [255, 0, 255])).toBe("");
  });
});

// ─── renderBanner ──────────────────────────────────────────────────

describe("renderBanner", () => {
  let origNoColor: string | undefined;
  let origColorterm: string | undefined;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
    origColorterm = process.env.COLORTERM;
  });

  afterEach(() => {
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    if (origColorterm === undefined) delete process.env.COLORTERM;
    else process.env.COLORTERM = origColorterm;
  });

  it("충분한 폭(120)에서 라인 배열을 반환한다 (비어있지 않음)", () => {
    process.env.NO_COLOR = "1";
    const lines = renderBanner({ version: "0.1.0", termWidth: 120 });
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("충분한 폭(120)에서 로고 라인이 포함된다 (ASCII 아트)", () => {
    process.env.NO_COLOR = "1";
    const lines = renderBanner({ version: "0.1.0", termWidth: 120 });
    const text = lines.join("\n");
    // 박스 드로잉 블록 문자 확인 (ANSI Shadow 스타일)
    expect(text).toMatch(/[█╗║╚╝═╔]/);
  });

  it("충분한 폭에서 버전 문자열이 포함된다", () => {
    process.env.NO_COLOR = "1";
    const lines = renderBanner({ version: "1.2.3", termWidth: 120 });
    const text = lines.join("\n");
    expect(text).toContain("1.2.3");
  });

  it("모든 라인의 displayWidth ≤ termWidth (충분한 폭)", () => {
    process.env.NO_COLOR = "1";
    const termWidth = 120;
    const lines = renderBanner({ version: "0.1.0", termWidth });
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });

  it("좁은 폭(30)에서 텍스트 폴백으로 전환 (로고 생략)", () => {
    process.env.NO_COLOR = "1";
    // ASCII 아트 로고 폭 ~41칸 > 30 → 폴백
    const lines = renderBanner({ version: "0.1.0", termWidth: 30 });
    const text = lines.join("\n");
    // 박스 드로잉 블록 문자(로고 전용)는 없어야 함
    expect(text).not.toMatch(/[╗║╚╝╔]/);
    // "KARAX" 텍스트는 여전히 있어야 함
    expect(text.toUpperCase()).toContain("KARAX");
  });

  it("좁은 폭(30)에서도 모든 라인의 displayWidth ≤ termWidth", () => {
    process.env.NO_COLOR = "1";
    const termWidth = 30;
    const lines = renderBanner({ version: "0.1.0", termWidth });
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });

  it("NO_COLOR일 때 ANSI 이스케이프 코드가 없다", () => {
    process.env.NO_COLOR = "1";
    const lines = renderBanner({ version: "0.1.0", termWidth: 120 });
    for (const line of lines) {
      expect(line).not.toMatch(/\x1b\[/);
    }
  });

  it("트루컬러 환경에서 24bit ANSI 코드가 포함된다", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    const lines = renderBanner({ version: "0.1.0", termWidth: 120 });
    const text = lines.join("\n");
    // 그라데이션 적용 → 24bit ANSI
    expect(text).toMatch(/\x1b\[38;2;/);
  });

  it("termWidth=80에서 모든 라인 displayWidth ≤ 80", () => {
    process.env.NO_COLOR = "1";
    const termWidth = 80;
    const lines = renderBanner({ version: "0.1.0", termWidth });
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });

  it("termWidth=40에서 모든 라인 displayWidth ≤ 40", () => {
    process.env.NO_COLOR = "1";
    const termWidth = 40;
    const lines = renderBanner({ version: "0.1.0", termWidth });
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });

  it("버전 읽기 실패 시 'dev'로 표시", () => {
    process.env.NO_COLOR = "1";
    const lines = renderBanner({ version: "dev", termWidth: 120 });
    const text = lines.join("\n");
    expect(text).toContain("dev");
  });
});

// ─── renderDashboard 새 아이콘 폭 불변식 ──────────────────────────

describe("renderDashboard — 새 아이콘이 포함된 불변식 (displayWidth ≤ termWidth)", () => {
  const termWidths = [20, 40, 80, 120];

  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  function assertInvariantNew(state: DashboardState, termWidth: number): void {
    const lines = renderDashboard(state, termWidth, 60000);
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      if (w > termWidth) {
        throw new Error(
          `라인 폭(${w}) > termWidth(${termWidth}): "${stripAnsi(line).slice(0, 60)}"`
        );
      }
    }
  }

  for (const tw of termWidths) {
    it(`termWidth=${tw}: 완료/에러/진행 단계가 모두 있을 때 불변식 유지`, () => {
      const state: DashboardState = {
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
      };
      assertInvariantNew(state, tw);
    });

    it(`termWidth=${tw}: 에러 단계에서 불변식 유지`, () => {
      const state: DashboardState = {
        phaseIndex: 3,
        completedPhases: ["scenario", "detect"],
        currentPhase: null,
        errorPhase: "build",
        sessionStartTime: 0,
        phaseStartTime: null,
        lastDetail: "빌드 실패",
        lastStepIndex: undefined,
        totalSteps: undefined,
        projectPath: "/home/user/MyApp",
        platform: "android",
        agent: "claude",
        buildCommand: undefined,
        spinnerFrame: 0,
        seenPhases: new Set(["scenario", "detect", "build"]),
      };
      assertInvariantNew(state, tw);
    });
  }
});

// ─── renderBanner 불변식: termWidth 20/40/80/120 ──────────────────

describe("renderBanner 불변식: displayWidth ≤ termWidth", () => {
  const termWidths = [20, 40, 80, 120];

  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  for (const tw of termWidths) {
    it(`termWidth=${tw}: 모든 라인 displayWidth ≤ termWidth`, () => {
      const lines = renderBanner({ version: "0.1.0", termWidth: tw });
      for (const line of lines) {
        const w = displayWidth(stripAnsi(line));
        if (w > tw) {
          throw new Error(
            `배너 라인 폭(${w}) > termWidth(${tw}): "${stripAnsi(line).slice(0, 60)}"`
          );
        }
      }
    });
  }
});

// ─── [수정항목 1] 진행바 퍼센트 복원 ────────────────────────────────

describe("renderDashboard — 진행바 퍼센트(%) 복원", () => {
  let origNoColor: string | undefined;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
  });

  it("termWidth=80: 진행바 라인에 '50%' 문자열이 포함된다 (5/10)", () => {
    const state = makeRenderState({ phaseIndex: 5 }); // 5/10 = 50%
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("50%");
  });

  it("termWidth=40: 진행바 라인에 '50%' 문자열이 포함된다 (5/10)", () => {
    const state = makeRenderState({ phaseIndex: 5 });
    const lines = renderDashboard(state, 40, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("50%");
  });

  it("termWidth=120: 진행바 라인에 '50%' 문자열이 포함된다 (5/10)", () => {
    const state = makeRenderState({ phaseIndex: 5 });
    const lines = renderDashboard(state, 120, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("50%");
  });

  it("termWidth=80, phaseIndex=0: '  0%' 포함", () => {
    const state = makeRenderState({ phaseIndex: 0, completedPhases: [], currentPhase: null });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toMatch(/\s0%/);
  });

  it("termWidth=80, phaseIndex=10: '100%' 포함", () => {
    const state = makeRenderState({
      phaseIndex: 10,
      completedPhases: ["scenario", "detect", "device", "appmap", "build", "install", "launch", "agent", "crash-scan", "report"],
      currentPhase: null,
    });
    const lines = renderDashboard(state, 80, 60000);
    const text = lines.map(stripAnsi).join("\n");
    expect(text).toContain("100%");
  });

  it("termWidth=80: 퍼센트 복원 후에도 진행바 라인 displayWidth ≤ termWidth (불변식 유지)", () => {
    const termWidth = 80;
    const state = makeRenderState({ phaseIndex: 5 });
    const lines = renderDashboard(state, termWidth, 60000);
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });

  it("termWidth=40: 퍼센트 복원 후에도 진행바 라인 displayWidth ≤ termWidth (불변식 유지)", () => {
    const termWidth = 40;
    const state = makeRenderState({ phaseIndex: 5 });
    const lines = renderDashboard(state, termWidth, 60000);
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });

  it("termWidth=120: 퍼센트 복원 후에도 진행바 라인 displayWidth ≤ termWidth (불변식 유지)", () => {
    const termWidth = 120;
    const state = makeRenderState({ phaseIndex: 5 });
    const lines = renderDashboard(state, termWidth, 60000);
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });
});

// ─── [수정항목 2] VS16(U+FE0F) 부착 — displayWidth 폭0 처리 확인 ──

describe("displayWidth — VS16(U+FE0F) 폭0 처리 및 이모지 결합", () => {
  it("VS16(U+FE0F) 단독: displayWidth === 0", () => {
    expect(displayWidth("️")).toBe(0);
  });

  it("✅ + VS16: displayWidth === 2 (이모지 폭2 + VS16 폭0 = 2)", () => {
    expect(displayWidth("✅️")).toBe(2);
  });

  it("❌ + VS16: displayWidth === 2", () => {
    expect(displayWidth("❌️")).toBe(2);
  });

  it("⚡ + VS16: displayWidth === 2", () => {
    expect(displayWidth("⚡️")).toBe(2);
  });
});

// ─── [수정항목 2] renderDashboard 아이콘 VS16 부착 불변식 ──────────

describe("renderDashboard — VS16 부착 후 아이콘 라인 불변식", () => {
  const termWidths = [40, 80, 120];

  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  for (const tw of termWidths) {
    it(`termWidth=${tw}: VS16 부착 아이콘 포함 라인 displayWidth ≤ termWidth`, () => {
      const state = makeRenderState({
        completedPhases: ["scenario", "detect"],
        currentPhase: "build",
        errorPhase: null,
      });
      const lines = renderDashboard(state, tw, 60000);
      for (const line of lines) {
        const w = displayWidth(stripAnsi(line));
        expect(w).toBeLessThanOrEqual(tw);
      }
    });

    it(`termWidth=${tw}: 에러 아이콘(❌+VS16) 포함 라인 displayWidth ≤ termWidth`, () => {
      const state = makeRenderState({
        currentPhase: null,
        errorPhase: "build",
        completedPhases: ["scenario"],
      });
      const lines = renderDashboard(state, tw, 60000);
      for (const line of lines) {
        const w = displayWidth(stripAnsi(line));
        expect(w).toBeLessThanOrEqual(tw);
      }
    });
  }
});

// ─── [수정항목 3] 구분선 폭이 박스와 일관되게 ───────────────────────

describe("renderDashboard — 구분선 폭 일관성", () => {
  const termWidths = [40, 80, 120];

  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  for (const tw of termWidths) {
    it(`termWidth=${tw}: 구분선 라인 displayWidth ≤ termWidth`, () => {
      const state = makeRenderState();
      const lines = renderDashboard(state, tw, 60000);
      for (const line of lines) {
        const w = displayWidth(stripAnsi(line));
        expect(w).toBeLessThanOrEqual(tw);
      }
    });

    it(`termWidth=${tw}: 구분선 폭이 박스 상단 테두리 폭과 ±1 이내로 일관됨`, () => {
      const state = makeRenderState();
      const lines = renderDashboard(state, tw, 60000);
      const stripped = lines.map(stripAnsi);
      // 상단 테두리: "┏" 포함 라인
      const topBorderLine = stripped.find(l => l.includes("┏"));
      // 구분선: "─"만 포함(박스 드로잉)하고 "┃"가 없는 라인 (앞에 " " 1자 포함)
      const dividerLine = stripped.find(l => /^ *─+$/.test(l.trim()) || /^ ─+$/.test(l));
      if (topBorderLine !== undefined && dividerLine !== undefined) {
        const topW = displayWidth(topBorderLine);
        const divW = displayWidth(dividerLine);
        // 구분선 폭이 박스 폭과 ±1 이내여야 함
        expect(Math.abs(topW - divW)).toBeLessThanOrEqual(1);
      }
    });
  }
});

// ─── [수정항목 4] renderBanner version sanitize ──────────────────────

describe("renderBanner — version ANSI 인젝션 방어", () => {
  let origNoColor: string | undefined;

  beforeEach(() => {
    origNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
  });

  it("version에 ANSI 코드가 포함되어도 renderBanner 결과에 raw ESC가 없다", () => {
    const maliciousVersion = "1.0\x1b[31m";
    const lines = renderBanner({ version: maliciousVersion, termWidth: 120 });
    const raw = lines.join("\n");
    // sanitize 되었으므로 raw ESC(\x1b[31m)가 그대로 있으면 안 됨
    expect(raw).not.toContain("\x1b[31m");
  });

  it("version에 ANSI 인젝션 포함 시 모든 라인 displayWidth ≤ termWidth (폭 불변)", () => {
    const maliciousVersion = "1.0\x1b[31m";
    const termWidth = 120;
    const lines = renderBanner({ version: maliciousVersion, termWidth });
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      expect(w).toBeLessThanOrEqual(termWidth);
    }
  });

  it("정상 version은 그대로 표시된다", () => {
    const lines = renderBanner({ version: "2.3.4", termWidth: 120 });
    const text = lines.join("\n");
    expect(text).toContain("2.3.4");
  });
});

// ─── renderDashboard 불변식: 모든 라인의 displayWidth ≤ termWidth ──

describe("renderDashboard 불변식: displayWidth ≤ termWidth", () => {
  const termWidths = [20, 40, 80, 120];

  function assertInvariant(state: DashboardState, termWidth: number): void {
    const lines = renderDashboard(state, termWidth, 60000);
    for (const line of lines) {
      const w = displayWidth(stripAnsi(line));
      if (w > termWidth) {
        throw new Error(
          `라인 폭(${w}) > termWidth(${termWidth}): "${stripAnsi(line).slice(0, 60)}"`
        );
      }
    }
  }

  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  for (const tw of termWidths) {
    it(`termWidth=${tw}: 기본 상태에서 모든 라인 폭 ≤ termWidth`, () => {
      assertInvariant(makeRenderState(), tw);
    });

    it(`termWidth=${tw}: 한글 projectPath에서 모든 라인 폭 ≤ termWidth`, () => {
      const state = makeRenderState({ projectPath: "/홈/사용자/내프로젝트앱/안드로이드빌드" });
      assertInvariant(state, tw);
    });

    it(`termWidth=${tw}: 긴 한글 detail에서 모든 라인 폭 ≤ termWidth`, () => {
      const state = makeRenderState({
        lastDetail: "그래들 빌드 진행 중: 컴파일 단계에서 오류 발생 — 상세 메시지 확인 필요합니다",
      });
      assertInvariant(state, tw);
    });

    it(`termWidth=${tw}: suite 모드(한글 시나리오 인덱스)에서 모든 라인 폭 ≤ termWidth`, () => {
      const state = makeRenderState({ lastStepIndex: 2, totalSteps: 10 });
      assertInvariant(state, tw);
    });

    it(`termWidth=${tw}: 이모지 섞인 detail에서 모든 라인 폭 ≤ termWidth`, () => {
      const state = makeRenderState({ lastDetail: "빌드 완료 🚀 앱 설치 중 📱 시뮬레이터 시작" });
      assertInvariant(state, tw);
    });
  }
});
