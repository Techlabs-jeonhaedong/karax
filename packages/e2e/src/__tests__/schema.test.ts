/**
 * agent/resultSchema.ts + report/schema.ts zod 스키마 테스트
 */

import { describe, it, expect } from "vitest";
import { AgentResultSchema } from "../agent/resultSchema.js";
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
