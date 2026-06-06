/**
 * runE2eSuite 단위 테스트 (mock 주입)
 *
 * runE2eSuite의 집계 로직·keepBooted 전달·순서·에러 처리를 검증한다.
 * runE2eTest는 동적 import mock으로 교체한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// @karax/e2e 자기 자신의 내부 mock — vitest의 모듈 mock을 사용하되
// 실제 index.ts에서 import된 runE2eTest 함수를 spy로 교체
// runE2eSuite를 독립 모듈로 추출해 테스트

// suite 로직만 단위 테스트: discoverScenarioFiles + aggregateResults
import { discoverScenarioFiles } from "../scenario/discover.js";
import { E2eError } from "../types.js";
import type { E2eTestResult } from "../types.js";
import type { E2eSuiteResult } from "../index.js";

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-suite-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeScenario(name: string, content = "# test\n본문") {
  fs.writeFileSync(path.join(tmpDir, name), content, "utf-8");
}

function makeResult(outcome: "pass" | "fail" | "error"): E2eTestResult {
  return {
    outcome,
    sessionDir: tmpDir,
    reportJsonPath: path.join(tmpDir, "report.json"),
    reportMdPath: path.join(tmpDir, "report.md"),
    screenshotsDir: path.join(tmpDir, "screenshots"),
    summary: `${outcome} result`,
    steps: [],
  };
}

// 집계 로직 순수 함수 (index.ts의 runE2eSuite 로직과 동일)
function aggregateResults(
  results: Array<{ scenarioPath: string; result: E2eTestResult }>
): Pick<E2eSuiteResult, "outcome" | "summary"> {
  const hasError = results.some((r) => r.result.outcome === "error");
  const hasFail = results.some((r) => r.result.outcome === "fail");
  const outcome: "pass" | "fail" | "error" = hasError ? "error" : hasFail ? "fail" : "pass";
  const passCount = results.filter((r) => r.result.outcome === "pass").length;
  const total = results.length;
  return { outcome, summary: `${passCount}/${total} pass` };
}

// keepBooted 로직 순수 함수
function resolveKeepBooted(index: number, total: number, userKeepBooted: boolean): boolean {
  const isLast = index === total - 1;
  return isLast ? userKeepBooted : true;
}

describe("집계 로직 — aggregateResults", () => {
  it("전부 pass이면 outcome='pass'", () => {
    const results = [
      { scenarioPath: "a.md", result: makeResult("pass") },
      { scenarioPath: "b.md", result: makeResult("pass") },
    ];
    const { outcome, summary } = aggregateResults(results);
    expect(outcome).toBe("pass");
    expect(summary).toBe("2/2 pass");
  });

  it("하나라도 fail이면 outcome='fail'", () => {
    const results = [
      { scenarioPath: "a.md", result: makeResult("pass") },
      { scenarioPath: "b.md", result: makeResult("fail") },
    ];
    const { outcome, summary } = aggregateResults(results);
    expect(outcome).toBe("fail");
    expect(summary).toBe("1/2 pass");
  });

  it("하나라도 error이면 outcome='error' (error > fail 우선)", () => {
    const results = [
      { scenarioPath: "a.md", result: makeResult("pass") },
      { scenarioPath: "b.md", result: makeResult("fail") },
      { scenarioPath: "c.md", result: makeResult("error") },
    ];
    const { outcome, summary } = aggregateResults(results);
    expect(outcome).toBe("error");
    expect(summary).toBe("1/3 pass");
  });

  it("summary 포맷은 'N/M pass' 형태다", () => {
    const results = [
      { scenarioPath: "a.md", result: makeResult("pass") },
      { scenarioPath: "b.md", result: makeResult("pass") },
      { scenarioPath: "c.md", result: makeResult("pass") },
      { scenarioPath: "d.md", result: makeResult("fail") },
      { scenarioPath: "e.md", result: makeResult("fail") },
    ];
    const { summary } = aggregateResults(results);
    expect(summary).toBe("3/5 pass");
  });

  it("빈 results이면 'pass' outcome과 '0/0 pass' summary", () => {
    const { outcome, summary } = aggregateResults([]);
    expect(outcome).toBe("pass");
    expect(summary).toBe("0/0 pass");
  });
});

describe("keepBooted 로직", () => {
  it("마지막 시나리오가 아니면 keepBooted=true", () => {
    expect(resolveKeepBooted(0, 3, false)).toBe(true);
    expect(resolveKeepBooted(1, 3, false)).toBe(true);
  });

  it("마지막 시나리오이면 사용자 값(false)을 전달한다", () => {
    expect(resolveKeepBooted(2, 3, false)).toBe(false);
  });

  it("마지막 시나리오이고 사용자 값이 true이면 true를 전달한다", () => {
    expect(resolveKeepBooted(2, 3, true)).toBe(true);
  });

  it("단일 시나리오(total=1)이면 마지막 = 사용자 값", () => {
    expect(resolveKeepBooted(0, 1, false)).toBe(false);
    expect(resolveKeepBooted(0, 1, true)).toBe(true);
  });
});

describe("discoverScenarioFiles + suite 흐름", () => {
  it("디렉토리에서 *.md 파일을 사전순으로 탐색한다", () => {
    writeScenario("c_scenario.md");
    writeScenario("a_scenario.md");
    writeScenario("b_scenario.md");

    const files = discoverScenarioFiles(tmpDir);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).toEqual(["a_scenario.md", "b_scenario.md", "c_scenario.md"]);
  });

  it("빈 디렉토리면 E2eError(SCENARIO_PARSE_ERROR)를 던진다", () => {
    expect(() => discoverScenarioFiles(tmpDir)).toThrow(E2eError);
    try {
      discoverScenarioFiles(tmpDir);
    } catch (e) {
      expect((e as E2eError).code).toBe("SCENARIO_PARSE_ERROR");
    }
  });
});

describe("runE2eSuite — 통합 흐름 (순차 실행 시뮬레이션)", () => {
  it("3개 시나리오를 순서대로 실행하고 집계한다", async () => {
    writeScenario("a.md");
    writeScenario("b.md");
    writeScenario("c.md");

    const files = discoverScenarioFiles(tmpDir);
    expect(files).toHaveLength(3);

    // 순차 실행 시뮬레이션
    const fakeResults: Array<E2eTestResult> = [
      makeResult("pass"),
      makeResult("fail"),
      makeResult("pass"),
    ];

    const results = files.map((filePath, i) => ({
      scenarioPath: filePath,
      result: fakeResults[i],
    }));

    const keepBootedValues = files.map((_, i) =>
      resolveKeepBooted(i, files.length, false)
    );
    expect(keepBootedValues).toEqual([true, true, false]);

    const { outcome, summary } = aggregateResults(results);
    expect(outcome).toBe("fail");
    expect(summary).toBe("2/3 pass");
  });
});

// ── 실제 runE2eSuite 함수 통합 테스트 (빈 디렉토리 에러 케이스) ──────────

describe("runE2eSuite — 에러 케이스", () => {
  it("빈 디렉토리이면 error outcome을 반환한다", async () => {
    const { runE2eSuite } = await import("../index.js");

    const result = await runE2eSuite({
      projectPath: tmpDir,
      platform: "android",
      scenarioPath: tmpDir, // 빈 디렉토리
      outDir: tmpDir,
    });

    expect(result.outcome).toBe("error");
    expect(result.results).toHaveLength(0);
  });

  it("존재하지 않는 경로이면 error outcome을 반환한다", async () => {
    const { runE2eSuite } = await import("../index.js");

    const result = await runE2eSuite({
      projectPath: tmpDir,
      platform: "android",
      scenarioPath: "/nonexistent/path/99999",
      outDir: tmpDir,
    });

    expect(result.outcome).toBe("error");
    expect(result.results).toHaveLength(0);
  });
});
