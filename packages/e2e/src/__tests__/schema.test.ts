/**
 * agent/resultSchema.ts + report/schema.ts zod 스키마 테스트
 */

import { describe, it, expect } from "vitest";
import { AgentResultSchema, FindingSchema } from "../agent/resultSchema.js";
import { E2eReportSchema } from "../report/schema.js";

// ── AgentResultSchema ─────────────────────────────────────────────

describe("AgentResultSchema", () => {
  it("유효한 pass 결과를 검증한다", () => {
    const data = {
      outcome: "pass",
      summary: "모든 테스트 통과",
      steps: [
        {
          index: 1,
          description: "로그인 버튼 탭",
          status: "pass",
          screenshot: "step_1.png",
        },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).not.toThrow();
  });

  it("outcome이 pass/fail 외 값이면 실패", () => {
    const data = { outcome: "unknown", summary: "요약", steps: [] };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("steps 없으면 실패", () => {
    const data = { outcome: "pass", summary: "요약" };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("summary 없으면 실패", () => {
    const data = { outcome: "pass", steps: [] };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("step에 note/screenshot은 선택 사항", () => {
    const data = {
      outcome: "fail",
      summary: "실패",
      steps: [{ index: 1, description: "탭", status: "fail" }],
    };
    expect(() => AgentResultSchema.parse(data)).not.toThrow();
  });

  it("step.status가 pass/fail/skip 외 값이면 실패", () => {
    const data = {
      outcome: "pass",
      summary: "요약",
      steps: [{ index: 1, description: "탭", status: "invalid" }],
    };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("빈 steps 배열은 허용된다", () => {
    const data = { outcome: "pass", summary: "요약", steps: [] };
    expect(() => AgentResultSchema.parse(data)).not.toThrow();
  });

  // ── M7: findings / visitedScreens 필드 ───────────────────────────

  it("v1 result.json(신규 필드 없음)이 그대로 파싱된다 (하위호환)", () => {
    const v1Data = {
      outcome: "pass",
      summary: "모든 테스트 통과",
      steps: [{ index: 1, description: "탭", status: "pass" }],
    };
    const parsed = AgentResultSchema.parse(v1Data);
    expect(parsed.outcome).toBe("pass");
    expect(parsed.findings).toBeUndefined();
    expect(parsed.visitedScreens).toBeUndefined();
  });

  it("findings 배열이 있을 때 파싱된다", () => {
    const data = {
      outcome: "pass",
      summary: "탐색 완료",
      steps: [],
      findings: [
        {
          id: "f1",
          severity: "major",
          category: "layout-overflow",
          description: "텍스트가 잘림",
          screenId: "home",
          evidence: "step_1.png",
          reproSteps: ["홈 화면 진입", "텍스트 영역 확인"],
        },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).not.toThrow();
    const parsed = AgentResultSchema.parse(data);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings![0].category).toBe("layout-overflow");
  });

  it("visitedScreens 배열이 있을 때 파싱된다", () => {
    const data = {
      outcome: "pass",
      summary: "탐색 완료",
      steps: [],
      visitedScreens: ["home", "detail", "settings"],
    };
    const parsed = AgentResultSchema.parse(data);
    expect(parsed.visitedScreens).toEqual(["home", "detail", "settings"]);
  });

  it("findings와 visitedScreens가 모두 없어도 파싱된다 (선택 필드)", () => {
    const data = { outcome: "pass", summary: "요약", steps: [] };
    const parsed = AgentResultSchema.parse(data);
    expect(parsed.findings).toBeUndefined();
    expect(parsed.visitedScreens).toBeUndefined();
  });

  it("findings 라운드트립: parse → toEqual 원본", () => {
    const findings = [
      {
        id: "f1",
        severity: "critical" as const,
        category: "crash" as const,
        description: "앱이 강제 종료됨",
      },
    ];
    const data = { outcome: "fail", summary: "크래시", steps: [], findings };
    const parsed = AgentResultSchema.parse(data);
    // default 없는 순수 optional이므로 라운드트립 보존
    expect(parsed.findings).toEqual(findings);
  });

  it("잘못된 category는 거부된다", () => {
    const data = {
      outcome: "pass",
      summary: "요약",
      steps: [],
      findings: [
        {
          id: "f1",
          severity: "major",
          category: "invalid-category",
          description: "설명",
        },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("잘못된 severity는 거부된다", () => {
    const data = {
      outcome: "pass",
      summary: "요약",
      steps: [],
      findings: [
        {
          id: "f1",
          severity: "high", // 올바르지 않은 값
          category: "crash",
          description: "설명",
        },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("finding의 id가 빈 문자열이면 거부된다", () => {
    const data = {
      outcome: "pass",
      summary: "요약",
      steps: [],
      findings: [
        { id: "", severity: "major", category: "crash", description: "설명" },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("finding의 description이 빈 문자열이면 거부된다", () => {
    const data = {
      outcome: "pass",
      summary: "요약",
      steps: [],
      findings: [
        { id: "f1", severity: "major", category: "crash", description: "" },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).toThrow();
  });

  it("finding의 evidence, screenId, reproSteps는 선택 사항이다", () => {
    const data = {
      outcome: "pass",
      summary: "요약",
      steps: [],
      findings: [
        { id: "f1", severity: "minor", category: "other", description: "사소한 문제" },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).not.toThrow();
    const parsed = AgentResultSchema.parse(data);
    expect(parsed.findings![0].evidence).toBeUndefined();
    expect(parsed.findings![0].screenId).toBeUndefined();
    expect(parsed.findings![0].reproSteps).toBeUndefined();
  });

  it("AgentStep에 expected/actual/screenId 선택 필드가 허용된다", () => {
    const data = {
      outcome: "pass",
      summary: "요약",
      steps: [
        {
          index: 1,
          description: "로그인",
          status: "pass",
          expected: "로그인 성공 화면",
          actual: "로그인 성공 화면",
          screenId: "login",
        },
      ],
    };
    expect(() => AgentResultSchema.parse(data)).not.toThrow();
    const parsed = AgentResultSchema.parse(data);
    expect(parsed.steps[0].expected).toBe("로그인 성공 화면");
    expect(parsed.steps[0].actual).toBe("로그인 성공 화면");
    expect(parsed.steps[0].screenId).toBe("login");
  });
});

// ── FindingSchema ─────────────────────────────────────────────────

describe("FindingSchema", () => {
  it("유효한 finding을 파싱한다", () => {
    const data = {
      id: "f-001",
      severity: "major",
      category: "layout-overflow",
      description: "텍스트가 경계를 넘음",
      screenId: "home",
      evidence: "step_3.png",
      reproSteps: ["홈 진입", "스크롤 없이 확인"],
    };
    expect(() => FindingSchema.parse(data)).not.toThrow();
  });

  it("모든 카테고리 값이 허용된다", () => {
    const categories = [
      "crash", "layout-overflow", "untranslated-text", "dead-button",
      "navigation-inconsistency", "slow-response", "accessibility",
      "visual-glitch", "error-state", "other",
    ];
    for (const cat of categories) {
      expect(() =>
        FindingSchema.parse({ id: "f1", severity: "minor", category: cat, description: "설명" })
      ).not.toThrow();
    }
  });

  it("모든 severity 값이 허용된다", () => {
    for (const sev of ["critical", "major", "minor"]) {
      expect(() =>
        FindingSchema.parse({ id: "f1", severity: sev, category: "other", description: "설명" })
      ).not.toThrow();
    }
  });
});

// ── E2eReportSchema ───────────────────────────────────────────────

describe("E2eReportSchema", () => {
  it("유효한 report를 검증한다", () => {
    const data = {
      sessionId: "2024-01-01T00-00-00",
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "모든 테스트 통과",
      steps: [],
      screenshotsDir: "/tmp/screenshots",
      durationMs: 1000,
      createdAt: new Date().toISOString(),
    };
    expect(() => E2eReportSchema.parse(data)).not.toThrow();
  });

  it("platform이 android/ios 외 값이면 실패", () => {
    const data = {
      sessionId: "abc",
      projectPath: "/tmp",
      platform: "windows",
      agent: "claude",
      outcome: "pass",
      summary: "요약",
      steps: [],
      screenshotsDir: "/tmp",
      durationMs: 0,
      createdAt: new Date().toISOString(),
    };
    expect(() => E2eReportSchema.parse(data)).toThrow();
  });

  it("durationMs가 음수이면 실패", () => {
    const data = {
      sessionId: "abc",
      projectPath: "/tmp",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "요약",
      steps: [],
      screenshotsDir: "/tmp",
      durationMs: -1,
      createdAt: new Date().toISOString(),
    };
    expect(() => E2eReportSchema.parse(data)).toThrow();
  });

  it("scenarioPath는 선택 사항", () => {
    const data = {
      sessionId: "abc",
      projectPath: "/tmp",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "요약",
      steps: [],
      screenshotsDir: "/tmp",
      durationMs: 0,
      createdAt: new Date().toISOString(),
    };
    expect(() => E2eReportSchema.parse(data)).not.toThrow();
  });
});
