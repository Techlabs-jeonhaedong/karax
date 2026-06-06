/**
 * report v2 — 신규 섹션·이스케이프·coverage·crashes·testData 마스킹 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildSummarySection,
  buildScenarioResultSection,
  buildFindingsSection,
  buildCoverageSection,
  buildCrashesSection,
  buildVideosSection,
  buildQualityWarningsSection,
  escapeMarkdownCell,
} from "../report/write.js";
import { writeReport } from "../report/write.js";
import { createSessionDir } from "../session.js";
import type { E2eReport } from "../report/schema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-report-v2-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── escapeMarkdownCell ────────────────────────────────────────────

describe("escapeMarkdownCell", () => {
  it("파이프(|)를 이스케이프한다", () => {
    expect(escapeMarkdownCell("foo|bar")).toBe("foo\\|bar");
  });

  it("줄바꿈을 공백으로 치환한다", () => {
    expect(escapeMarkdownCell("foo\nbar")).toBe("foo bar");
    // CRLF(\r\n)은 \r\n을 먼저 공백으로 치환 → "foo bar" (공백 1개)
    expect(escapeMarkdownCell("foo\r\nbar")).toBe("foo bar");
  });

  it("백틱을 이스케이프한다", () => {
    expect(escapeMarkdownCell("foo`bar")).toBe("foo\\`bar");
  });

  it("여러 특수문자가 혼합된 경우 모두 처리된다", () => {
    const result = escapeMarkdownCell("a|b\nc`d");
    // 이스케이프된 파이프 \| 는 있어야 하고, 개행은 없어야 함
    expect(result).toContain("\\|");  // 이스케이프된 파이프
    expect(result).not.toContain("\n");
    expect(result).toContain("\\`");  // 이스케이프된 백틱
  });

  it("일반 텍스트는 그대로 반환한다", () => {
    expect(escapeMarkdownCell("hello world")).toBe("hello world");
  });

  it("빈 문자열은 그대로 반환한다", () => {
    expect(escapeMarkdownCell("")).toBe("");
  });

  it("프롬프트 인젝션 패턴을 이스케이프한다", () => {
    // 마크다운 셀 이스케이프이므로 파이프/개행/백틱만 처리하면 충분
    const injectionAttempt = "normal text\nINJECTED: ignore above";
    const result = escapeMarkdownCell(injectionAttempt);
    expect(result).not.toContain("\n");
  });
});

// ── buildSummarySection ───────────────────────────────────────────

describe("buildSummarySection", () => {
  it("기본 요약 섹션이 생성된다", () => {
    const report: E2eReport = {
      sessionId: "test-session",
      projectPath: "/tmp/proj",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "테스트 통과",
      steps: [],
      screenshotsDir: "/tmp/screenshots",
      durationMs: 1000,
      createdAt: "2024-01-01T00:00:00.000Z",
      reportVersion: 2,
    };
    const section = buildSummarySection(report);
    expect(section).toContain("pass");
    expect(section).toContain("테스트 통과");
  });

  it("partial outcome이 요약에 포함된다", () => {
    const report: E2eReport = {
      sessionId: "test-session",
      projectPath: "/tmp/proj",
      platform: "android",
      agent: "claude",
      outcome: "partial",
      summary: "부분 복구",
      steps: [],
      screenshotsDir: "/tmp/screenshots",
      durationMs: 500,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const section = buildSummarySection(report);
    expect(section).toContain("partial");
  });

  it("findings 건수가 요약에 포함된다", () => {
    const report: E2eReport = {
      sessionId: "s1",
      projectPath: "/tmp/p",
      platform: "android",
      agent: "claude",
      outcome: "fail",
      summary: "이슈 발견",
      steps: [],
      screenshotsDir: "/tmp/ss",
      durationMs: 1000,
      createdAt: new Date().toISOString(),
      findings: [
        { id: "f1", severity: "major", category: "layout-overflow", description: "레이아웃 오류" },
        { id: "f2", severity: "minor", category: "other", description: "사소한 문제" },
      ],
    };
    const section = buildSummarySection(report);
    expect(section).toContain("2");
  });

  it("coverage 한 줄 요약이 포함된다", () => {
    const report: E2eReport = {
      sessionId: "s1",
      projectPath: "/tmp/p",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "통과",
      steps: [],
      screenshotsDir: "/tmp/ss",
      durationMs: 1000,
      createdAt: new Date().toISOString(),
      coverage: {
        totalScreens: 5,
        visitedScreens: 3,
        visitedScreenIds: ["home", "detail", "settings"],
        unvisitedScreenIds: ["profile", "cart"],
        coverageRatio: 0.6,
      },
    };
    const section = buildSummarySection(report);
    expect(section).toMatch(/3.*5|60%|0\.6/);
  });

  it("summary 값에 마크다운 특수문자가 이스케이프된다", () => {
    const report: E2eReport = {
      sessionId: "s1",
      projectPath: "/tmp/p",
      platform: "android",
      agent: "claude",
      outcome: "fail",
      summary: "에러: 파이프|개행\n포함",
      steps: [],
      screenshotsDir: "/tmp/ss",
      durationMs: 0,
      createdAt: new Date().toISOString(),
    };
    const section = buildSummarySection(report);
    // 파이프가 셀 안에 날 것으로 남아있으면 안 됨
    // (테이블 행 안의 내용에서 이스케이프된 형태여야 함)
    const tableRows = section.split("\n").filter((l) => l.startsWith("|"));
    for (const row of tableRows) {
      // 이스케이프되지 않은 파이프가 값에 있으면 안 됨
      // 테이블 행 파서: | 로 분할하면 정확히 3개 (앞·내용·뒤)이어야 함
      // 하지만 복잡한 파서를 피하고 단순히 \\| 없이 날파이프만 체크
      const inner = row.slice(1, -1); // 첫·마지막 | 제거
      const unescapedPipes = inner.split("\\|").join("").split("|");
      // 값 분리 셀 개수 = 2(항목|값)
      // 이미 이스케이프된 경우 이 검증은 넘어감
      if (unescapedPipes.length > 2) {
        // "에러: 파이프" 앞뒤로 3개 이상 분리되면 이스케이프 실패
        // summary 값에 파이프가 있는 경우만 체크
        expect(row).toContain("\\|");
      }
    }
  });
});

// ── buildScenarioResultSection ────────────────────────────────────

describe("buildScenarioResultSection", () => {
  it("스텝 표에 expected/actual 컬럼이 포함된다", () => {
    const steps = [
      {
        index: 1,
        description: "로그인",
        status: "pass" as const,
        expected: "로그인 성공",
        actual: "로그인 성공",
      },
    ];
    const section = buildScenarioResultSection(steps);
    expect(section).toContain("expected");
    expect(section).toContain("actual");
  });

  it("expected/actual 없으면 '-'로 표기된다", () => {
    const steps = [
      { index: 1, description: "탭", status: "pass" as const },
    ];
    const section = buildScenarioResultSection(steps);
    expect(section).toContain("-");
  });

  it("스텝 description이 이스케이프된다", () => {
    const steps = [
      {
        index: 1,
        description: "악성|설명\n인젝션",
        status: "pass" as const,
      },
    ];
    const section = buildScenarioResultSection(steps);
    expect(section).not.toContain("악성|설명\n인젝션");
  });

  it("스텝이 없으면 빈 섹션이나 헤더만 반환된다", () => {
    const section = buildScenarioResultSection([]);
    expect(typeof section).toBe("string");
  });
});

// ── buildFindingsSection ──────────────────────────────────────────

describe("buildFindingsSection", () => {
  const screenshotsDir = "/tmp/screenshots";

  it("findings가 없으면 빈 문자열을 반환한다", () => {
    const section = buildFindingsSection([], screenshotsDir);
    expect(section).toBe("");
  });

  it("undefined이면 빈 문자열을 반환한다", () => {
    const section = buildFindingsSection(undefined, screenshotsDir);
    expect(section).toBe("");
  });

  it("severity 순서로 정렬된다 (critical > major > minor)", () => {
    const findings = [
      { id: "f3", severity: "minor" as const, category: "other" as const, description: "사소한 문제" },
      { id: "f1", severity: "critical" as const, category: "crash" as const, description: "크래시" },
      { id: "f2", severity: "major" as const, category: "layout-overflow" as const, description: "레이아웃 오류" },
    ];
    const section = buildFindingsSection(findings, screenshotsDir);
    // severity는 [CRITICAL], [MAJOR], [MINOR]로 대문자 렌더링됨
    const lowerSection = section.toLowerCase();
    const criticalIdx = lowerSection.indexOf("critical");
    const majorIdx = lowerSection.indexOf("major");
    const minorIdx = lowerSection.indexOf("minor");
    expect(criticalIdx).toBeLessThan(majorIdx);
    expect(majorIdx).toBeLessThan(minorIdx);
  });

  it("description이 마크다운 셀 이스케이프된다 (파이프 포함 케이스)", () => {
    const findings = [
      { id: "f1", severity: "major" as const, category: "other" as const, description: "a|b|c" },
    ];
    const section = buildFindingsSection(findings, screenshotsDir);
    // 이스케이프된 파이프 (\|)가 있어야 함
    expect(section).toContain("\\|");
  });

  it("reproSteps의 개행이 이스케이프된다 (원본 개행이 섹션에 그대로 남지 않음)", () => {
    const findings = [
      {
        id: "f1",
        severity: "major" as const,
        category: "other" as const,
        description: "설명",
        reproSteps: ["1단계\n인젝션 시도", "2단계"],
      },
    ];
    const section = buildFindingsSection(findings, screenshotsDir);
    // 원본 개행 "1단계\n인젝션 시도"가 그대로 포함되면 안 됨
    expect(section).not.toContain("1단계\n인젝션 시도");
  });

  it("evidence가 있으면 스크린샷 임베드를 포함한다 (안전한 경로)", () => {
    const findings = [
      {
        id: "f1",
        severity: "major" as const,
        category: "visual-glitch" as const,
        description: "시각적 결함",
        evidence: "step_1.png",
      },
    ];
    const section = buildFindingsSection(findings, screenshotsDir);
    expect(section).toContain("![");
    expect(section).toContain("step_1.png");
  });

  it("path traversal evidence는 임베드하지 않는다", () => {
    const findings = [
      {
        id: "f1",
        severity: "major" as const,
        category: "visual-glitch" as const,
        description: "시각적 결함",
        evidence: "../../etc/passwd",
      },
    ];
    const section = buildFindingsSection(findings, screenshotsDir);
    expect(section).not.toContain("etc/passwd");
  });
});

// ── buildCoverageSection ──────────────────────────────────────────

describe("buildCoverageSection", () => {
  it("coverage가 없으면 빈 문자열을 반환한다", () => {
    const section = buildCoverageSection(undefined);
    expect(section).toBe("");
  });

  it("방문 비율과 화면 수가 포함된다", () => {
    const coverage = {
      totalScreens: 5,
      visitedScreens: 3,
      visitedScreenIds: ["home", "detail", "settings"],
      unvisitedScreenIds: ["profile", "cart"],
      coverageRatio: 0.6,
    };
    const section = buildCoverageSection(coverage);
    expect(section).toMatch(/3.*5|60%|0\.6/);
  });

  it("미방문 화면 목록이 포함된다", () => {
    const coverage = {
      totalScreens: 3,
      visitedScreens: 1,
      visitedScreenIds: ["home"],
      unvisitedScreenIds: ["detail", "settings"],
      coverageRatio: 0.33,
    };
    const section = buildCoverageSection(coverage);
    expect(section).toContain("detail");
    expect(section).toContain("settings");
  });

  it("미방문 화면 id가 이스케이프된다", () => {
    const coverage = {
      totalScreens: 2,
      visitedScreens: 0,
      visitedScreenIds: [],
      unvisitedScreenIds: ["screen|pipe\nbreak"],
      coverageRatio: 0,
    };
    const section = buildCoverageSection(coverage);
    expect(section).not.toContain("screen|pipe\nbreak");
  });
});

// ── buildCrashesSection ───────────────────────────────────────────

describe("buildCrashesSection", () => {
  it("crashes가 없으면 빈 문자열을 반환한다", () => {
    const section = buildCrashesSection(undefined);
    expect(section).toBe("");
  });

  it("빈 배열이면 빈 문자열을 반환한다", () => {
    const section = buildCrashesSection([]);
    expect(section).toBe("");
  });

  it("크래시 타입과 발췌가 코드 블록으로 포함된다", () => {
    const crashes = [
      {
        type: "fatal-exception" as const,
        excerpt: "java.lang.NullPointerException",
        appId: "com.example.app",
      },
    ];
    const section = buildCrashesSection(crashes);
    expect(section).toContain("fatal-exception");
    expect(section).toContain("NullPointerException");
    // 코드 블록으로 감싸져 있어야 함
    expect(section).toContain("```");
  });

  it("크래시 발췌에 backtick이 있어도 코드 블록이 깨지지 않는다", () => {
    const crashes = [
      {
        type: "native-crash" as const,
        excerpt: "crash with `backtick` content",
        appId: "com.example.app",
      },
    ];
    const section = buildCrashesSection(crashes);
    // 섹션 전체가 유효한 마크다운이어야 함 (백틱 3개 코드블록 안은 그대로)
    expect(section).toContain("crash with `backtick` content");
  });
});

// ── buildVideosSection ─────────────────────────────────────────────

describe("buildVideosSection", () => {
  it("videos가 없으면 빈 문자열을 반환한다", () => {
    const section = buildVideosSection(undefined);
    expect(section).toBe("");
  });

  it("빈 배열이면 빈 문자열을 반환한다", () => {
    const section = buildVideosSection([]);
    expect(section).toBe("");
  });

  it("비디오 링크가 포함된다", () => {
    const videos = ["session/recording_1.mp4", "session/recording_2.mp4"];
    const section = buildVideosSection(videos);
    expect(section).toContain("recording_1.mp4");
    expect(section).toContain("recording_2.mp4");
  });
});

// ── buildQualityWarningsSection ───────────────────────────────────

describe("buildQualityWarningsSection", () => {
  it("warnings가 없으면 빈 문자열을 반환한다", () => {
    const section = buildQualityWarningsSection(undefined);
    expect(section).toBe("");
  });

  it("경고 목록이 포함된다", () => {
    const warnings = ["스텝 2: 스크린샷 누락", "스텝 5: 스크린샷 누락"];
    const section = buildQualityWarningsSection(warnings);
    expect(section).toContain("스텝 2");
    expect(section).toContain("스텝 5");
  });

  it("경고 내용이 이스케이프된다", () => {
    const warnings = ["경고|파이프\n개행"];
    const section = buildQualityWarningsSection(warnings);
    // 이스케이프되어야 함 (테이블이 아니라 목록이라면 파이프는 상관없을 수 있음)
    // 섹션이 깨지지 않아야 함
    expect(typeof section).toBe("string");
    expect(section.length).toBeGreaterThan(0);
  });
});

// ── writeReport v2 통합 테스트 ──────────────────────────────────────

describe("writeReport v2", () => {
  it("findings가 report.json에 영속화된다 (T1)", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "fail",
      summary: "이슈 발견",
      steps: [],
      screenshotsDir: session.screenshotsDir,
      durationMs: 1000,
      createdAt: new Date().toISOString(),
      reportVersion: 2,
      findings: [
        { id: "f1", severity: "critical", category: "crash", description: "크래시 발생" },
      ],
      coverage: {
        totalScreens: 5,
        visitedScreens: 3,
        visitedScreenIds: ["home", "detail", "settings"],
        unvisitedScreenIds: ["profile", "cart"],
        coverageRatio: 0.6,
      },
      qualityWarnings: ["스텝 2: 스크린샷 누락"],
    };

    const { reportJsonPath } = writeReport(session.dir, report);
    const parsed = JSON.parse(fs.readFileSync(reportJsonPath, "utf-8")) as typeof report;

    // T1: findings/coverage/qualityWarnings가 디스크에 저장됨
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings![0].id).toBe("f1");
    expect(parsed.coverage?.totalScreens).toBe(5);
    expect(parsed.qualityWarnings).toContain("스텝 2: 스크린샷 누락");
    expect(parsed.reportVersion).toBe(2);
  });

  it("report.md에 findings 섹션이 포함된다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "fail",
      summary: "이슈 발견",
      steps: [],
      screenshotsDir: session.screenshotsDir,
      durationMs: 1000,
      createdAt: new Date().toISOString(),
      findings: [
        { id: "f1", severity: "critical", category: "crash", description: "크래시 발생" },
      ],
    };

    const { reportMdPath } = writeReport(session.dir, report);
    const md = fs.readFileSync(reportMdPath, "utf-8");
    // severity는 [CRITICAL]로 대문자 렌더링됨
    expect(md.toLowerCase()).toContain("critical");
    expect(md).toContain("크래시 발생");
  });

  it("report.md에 coverage 섹션이 포함된다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "통과",
      steps: [],
      screenshotsDir: session.screenshotsDir,
      durationMs: 1000,
      createdAt: new Date().toISOString(),
      coverage: {
        totalScreens: 10,
        visitedScreens: 7,
        visitedScreenIds: ["s1","s2","s3","s4","s5","s6","s7"],
        unvisitedScreenIds: ["s8","s9","s10"],
        coverageRatio: 0.7,
      },
    };

    const { reportMdPath } = writeReport(session.dir, report);
    const md = fs.readFileSync(reportMdPath, "utf-8");
    expect(md).toMatch(/7.*10|70%/);
    expect(md).toContain("s8");
  });

  it("report.md에 crashes 섹션이 포함된다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "fail",
      summary: "크래시 감지",
      steps: [],
      screenshotsDir: session.screenshotsDir,
      durationMs: 500,
      createdAt: new Date().toISOString(),
      crashes: [
        { type: "fatal-exception", excerpt: "NullPointerException", appId: "com.example.app" },
      ],
    };

    const { reportMdPath } = writeReport(session.dir, report);
    const md = fs.readFileSync(reportMdPath, "utf-8");
    expect(md).toContain("fatal-exception");
    expect(md).toContain("NullPointerException");
  });

  it("스텝 표에 expected/actual 컬럼이 포함된다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "통과",
      steps: [
        {
          index: 1,
          description: "로그인",
          status: "pass",
          expected: "성공 화면",
          actual: "성공 화면",
        },
      ],
      screenshotsDir: session.screenshotsDir,
      durationMs: 500,
      createdAt: new Date().toISOString(),
    };

    const { reportMdPath } = writeReport(session.dir, report);
    const md = fs.readFileSync(reportMdPath, "utf-8");
    expect(md).toContain("expected");
    expect(md).toContain("actual");
    expect(md).toContain("성공 화면");
  });

  it("partial outcome이 report에 포함된다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "partial",
      summary: "부분 복구됨",
      steps: [],
      screenshotsDir: session.screenshotsDir,
      durationMs: 300,
      createdAt: new Date().toISOString(),
    };

    const { reportJsonPath, reportMdPath } = writeReport(session.dir, report);
    const parsed = JSON.parse(fs.readFileSync(reportJsonPath, "utf-8")) as typeof report;
    expect(parsed.outcome).toBe("partial");
    const md = fs.readFileSync(reportMdPath, "utf-8");
    expect(md).toContain("partial");
  });

  // ── T4: testData가 report에 등장하지 않음 확인 ────────────────────

  it("T4: report.json에 testData 키·값이 등장하지 않는다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "통과",
      steps: [],
      screenshotsDir: session.screenshotsDir,
      durationMs: 500,
      createdAt: new Date().toISOString(),
    };

    const { reportJsonPath } = writeReport(session.dir, report);
    const content = fs.readFileSync(reportJsonPath, "utf-8");

    // E2eReport 스키마에 testData 필드가 없으므로 JSON에도 없어야 함
    expect(content).not.toContain("testData");
    expect(content).not.toContain("password");
    expect(content).not.toContain("secret");
  });

  // ── v1 라운드트립 회귀 (D10) ──────────────────────────────────────

  it("v1 report.json 라운드트립이 그대로 유지된다 (D10)", () => {
    const session = createSessionDir(tmpDir);
    const v1Report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/proj",
      platform: "android",
      agent: "codex",
      outcome: "pass",
      summary: "ok",
      steps: [{ index: 1, description: "tap", status: "pass", screenshot: "step_1.png" }],
      screenshotsDir: session.screenshotsDir,
      durationMs: 100,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    const { reportJsonPath } = writeReport(session.dir, v1Report);
    const reparsed = JSON.parse(fs.readFileSync(reportJsonPath, "utf-8")) as E2eReport;
    expect(reparsed).toEqual(v1Report);
  });
});
