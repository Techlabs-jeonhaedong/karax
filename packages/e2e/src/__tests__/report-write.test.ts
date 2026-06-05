/**
 * report/write.ts + session.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createSessionDir } from "../session.js";
import { writeReport } from "../report/write.js";
import { sanitizeScreenshotPath } from "../report/sanitize.js";
import type { E2eReport } from "../report/schema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-report-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── createSessionDir ──────────────────────────────────────────────

describe("createSessionDir", () => {
  it("outDir 아래에 타임스탬프 디렉토리를 생성한다", () => {
    const session = createSessionDir(tmpDir);
    expect(fs.existsSync(session.dir)).toBe(true);
    expect(session.dir.startsWith(tmpDir)).toBe(true);
  });

  it("screenshotsDir을 생성한다", () => {
    const session = createSessionDir(tmpDir);
    expect(fs.existsSync(session.screenshotsDir)).toBe(true);
  });

  it("sessionId가 타임스탬프 형식이다", () => {
    const session = createSessionDir(tmpDir);
    expect(session.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
  });
});

// ── writeReport ───────────────────────────────────────────────────

describe("writeReport", () => {
  it("report.json을 작성한다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "android",
      agent: "claude",
      outcome: "pass",
      summary: "테스트 통과",
      steps: [],
      screenshotsDir: session.screenshotsDir,
      durationMs: 500,
      createdAt: new Date().toISOString(),
    };

    const result = writeReport(session.dir, report);
    expect(fs.existsSync(result.reportJsonPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as E2eReport;
    expect(parsed.outcome).toBe("pass");
    expect(parsed.sessionId).toBe(session.sessionId);
  });

  it("report.md를 작성한다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath: "/tmp/project",
      platform: "ios",
      agent: "gemini",
      outcome: "fail",
      summary: "로그인 실패",
      steps: [
        { index: 1, description: "앱 실행", status: "pass" },
        { index: 2, description: "로그인 버튼 탭", status: "fail", note: "버튼 없음" },
      ],
      screenshotsDir: session.screenshotsDir,
      durationMs: 1200,
      createdAt: new Date().toISOString(),
    };

    const result = writeReport(session.dir, report);
    expect(fs.existsSync(result.reportMdPath)).toBe(true);

    const mdContent = fs.readFileSync(result.reportMdPath, "utf-8");
    expect(mdContent).toContain("fail");
    expect(mdContent).toContain("로그인 실패");
    expect(mdContent).toContain("로그인 버튼 탭");
  });

  it("report.json 라운드트립: 파싱된 값이 원본과 일치한다", () => {
    const session = createSessionDir(tmpDir);
    const report: E2eReport = {
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

    const result = writeReport(session.dir, report);
    const reparsed = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as E2eReport;
    expect(reparsed).toEqual(report);
  });
});

// ── sanitizeScreenshotPath — path traversal 방어 ────────────────

describe("sanitizeScreenshotPath", () => {
  it("정상 파일명을 그대로 반환한다", () => {
    const result = sanitizeScreenshotPath("/tmp/screenshots", "step_1.png");
    expect(result).toBe(path.join("/tmp/screenshots", "step_1.png"));
  });

  it("../../etc/passwd 경로를 거부한다 (null 반환)", () => {
    const result = sanitizeScreenshotPath("/tmp/screenshots", "../../etc/passwd");
    expect(result).toBeNull();
  });

  it("절대경로를 거부한다 (null 반환)", () => {
    const result = sanitizeScreenshotPath("/tmp/screenshots", "/etc/passwd");
    expect(result).toBeNull();
  });

  it("../other/file.png 를 거부한다 (null 반환)", () => {
    const result = sanitizeScreenshotPath("/tmp/screenshots", "../other/file.png");
    expect(result).toBeNull();
  });

  it("하위 디렉토리 경로는 허용한다", () => {
    const result = sanitizeScreenshotPath("/tmp/screenshots", "sub/step_1.png");
    expect(result).toBe(path.join("/tmp/screenshots", "sub", "step_1.png"));
  });

  it("빈 문자열을 거부한다 (null 반환)", () => {
    const result = sanitizeScreenshotPath("/tmp/screenshots", "");
    expect(result).toBeNull();
  });
});
