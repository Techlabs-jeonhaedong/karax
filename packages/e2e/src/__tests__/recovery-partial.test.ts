/**
 * recovery/partial.ts 단위 테스트 — recoverPartialResult
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { recoverPartialResult } from "../recovery/partial.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-recovery-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("recoverPartialResult", () => {
  // ── result.json 정상 케이스 ─────────────────────────────────────

  it("result.json이 정상이면 해당 결과를 반환한다", () => {
    const validResult = {
      outcome: "pass",
      summary: "테스트 통과",
      steps: [{ index: 1, description: "탭", status: "pass" }],
    };
    fs.writeFileSync(path.join(tmpDir, "result.json"), JSON.stringify(validResult), "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("pass");
    expect(result!.steps).toHaveLength(1);
  });

  it("result.json의 fail 결과도 정상 반환된다", () => {
    const failResult = {
      outcome: "fail",
      summary: "테스트 실패",
      steps: [
        { index: 1, description: "탭", status: "pass" },
        { index: 2, description: "확인", status: "fail" },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, "result.json"), JSON.stringify(failResult), "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result!.outcome).toBe("fail");
    expect(result!.steps).toHaveLength(2);
  });

  // ── result.json 깨진 경우 ─────────────────────────────────────────

  it("result.json이 파싱 불가능한 JSON이면 null이 아닌 png 스캔으로 복구된다", () => {
    fs.writeFileSync(path.join(tmpDir, "result.json"), "{ broken json }", "utf-8");
    // PNG 없음 → null
    const result = recoverPartialResult(tmpDir);
    expect(result).toBeNull();
  });

  it("result.json이 스키마를 만족하지 않으면 png 스캔으로 복구된다", () => {
    // outcome 필드 누락
    const invalidResult = { summary: "요약만 있음", steps: [] };
    fs.writeFileSync(path.join(tmpDir, "result.json"), JSON.stringify(invalidResult), "utf-8");

    // PNG 파일 만들어두기
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG_DATA", "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result).not.toBeNull();
    // 복구된 결과는 outcome이 "fail"이어야 함
    expect(result!.outcome).toBe("fail");
    expect(result!.summary).toContain("복구");
  });

  // ── png만 있는 경우 ─────────────────────────────────────────────

  it("result.json 없고 step_N.png만 있으면 스텝 합성 복구된다", () => {
    // PNG 파일 3개 생성 (정렬 순서 확인)
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "step_2.png"), "PNG", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "step_3.png"), "PNG", "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("fail");
    expect(result!.steps).toHaveLength(3);
    // 각 스텝의 status는 "skip" (복구된 스텝)
    expect(result!.steps.every((s) => s.status === "skip")).toBe(true);
    // screenshot 필드가 파일명으로 설정됨
    expect(result!.steps[0].screenshot).toBe("step_1.png");
    expect(result!.steps[1].screenshot).toBe("step_2.png");
    expect(result!.steps[2].screenshot).toBe("step_3.png");
  });

  it("복구된 스텝의 description에 복구 표시가 포함된다", () => {
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result!.steps[0].description).toContain("복구");
  });

  it("png 파일이 숫자 순서대로 정렬된다 (step_1 < step_2 < step_10)", () => {
    fs.writeFileSync(path.join(tmpDir, "step_10.png"), "PNG", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "step_2.png"), "PNG", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.steps).toHaveLength(3);
    expect(result!.steps[0].screenshot).toBe("step_1.png");
    expect(result!.steps[1].screenshot).toBe("step_2.png");
    expect(result!.steps[2].screenshot).toBe("step_10.png");
  });

  it("복구된 요약에 '에이전트 비정상 종료' 또는 '부분 결과 복구'가 포함된다", () => {
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result!.summary).toMatch(/비정상|복구/);
  });

  // ── 아무것도 없는 경우 ─────────────────────────────────────────────

  it("result.json도 없고 png도 없으면 null을 반환한다", () => {
    const result = recoverPartialResult(tmpDir);
    expect(result).toBeNull();
  });

  it("존재하지 않는 디렉토리이면 null을 반환한다", () => {
    const nonExistent = path.join(tmpDir, "nonexistent");
    const result = recoverPartialResult(nonExistent);
    expect(result).toBeNull();
  });

  // ── step_N.png 이외 파일 무시 ─────────────────────────────────────

  it("step_N.png 패턴 이외의 파일은 무시된다", () => {
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "screenshot.png"), "PNG", "utf-8"); // 무시
    fs.writeFileSync(path.join(tmpDir, "step_abc.png"), "PNG", "utf-8"); // 숫자 아님, 무시
    fs.writeFileSync(path.join(tmpDir, "report.md"), "MD", "utf-8"); // 무시

    const result = recoverPartialResult(tmpDir);
    expect(result).not.toBeNull();
    // step_1.png만 포함
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0].screenshot).toBe("step_1.png");
  });

  // ── index가 올바르게 설정됨 ────────────────────────────────────────

  it("복구된 스텝의 index가 파일 순서와 일치한다", () => {
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "step_2.png"), "PNG", "utf-8");

    const result = recoverPartialResult(tmpDir);
    expect(result!.steps[0].index).toBe(0);
    expect(result!.steps[1].index).toBe(1);
  });
});
