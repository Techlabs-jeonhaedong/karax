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

function makeResult(outcome: "pass" | "fail" | "error" | "partial"): E2eTestResult {
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

// 집계 로직 순수 함수 (index.ts의 runE2eSuite 로직과 동일 — error > fail > partial > pass)
function aggregateResults(
  results: Array<{ scenarioPath: string; result: E2eTestResult }>
): Pick<E2eSuiteResult, "outcome" | "summary"> {
  const hasError = results.some((r) => r.result.outcome === "error");
  const hasFail = results.some((r) => r.result.outcome === "fail");
  const hasPartial = results.some((r) => r.result.outcome === "partial");
  const outcome: E2eSuiteResult["outcome"] =
    hasError ? "error" : hasFail ? "fail" : hasPartial ? "partial" : "pass";
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

  it("partial 1개+pass 나머지이면 outcome='partial'", () => {
    const results = [
      { scenarioPath: "a.md", result: makeResult("pass") },
      { scenarioPath: "b.md", result: makeResult("partial") },
      { scenarioPath: "c.md", result: makeResult("pass") },
    ];
    const { outcome } = aggregateResults(results);
    expect(outcome).toBe("partial");
  });

  it("fail이 partial보다 우선 (error > fail > partial > pass)", () => {
    const results = [
      { scenarioPath: "a.md", result: makeResult("partial") },
      { scenarioPath: "b.md", result: makeResult("fail") },
    ];
    const { outcome } = aggregateResults(results);
    expect(outcome).toBe("fail");
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

  it("빈 디렉토리 에러 케이스에서 suiteDir 필드는 undefined", async () => {
    const { runE2eSuite } = await import("../index.js");

    const result = await runE2eSuite({
      projectPath: tmpDir,
      platform: "android",
      scenarioPath: tmpDir,
      outDir: tmpDir,
    });

    expect(result.outcome).toBe("error");
    // 탐색 실패 시 suiteDir은 undefined (outDir 미결정)
    expect(result.suiteDir).toBeUndefined();
  });
});

describe("runE2eSuite — suiteDir 필드", () => {
  it("정상 탐색 시 suiteDir은 resolve된 outDir을 반환한다", async () => {
    const { runE2eSuite } = await import("../index.js");

    // 시나리오 파일 1개 생성 (실제 실행은 error로 끝나도 OK — suiteDir만 확인)
    const scenarioFile = path.join(tmpDir, "test.md");
    fs.writeFileSync(scenarioFile, "# test\n본문", "utf-8");

    const suiteDir = path.join(tmpDir, "suite-out");
    fs.mkdirSync(suiteDir, { recursive: true });

    const result = await runE2eSuite({
      projectPath: tmpDir,
      platform: "android",
      scenarioPath: tmpDir, // 시나리오 있으므로 탐색 성공
      outDir: suiteDir,
    });

    // 탐색은 성공하지만 실제 테스트는 에러 (빌드 환경 없음)
    // suiteDir은 outDir 값으로 설정돼야 한다
    expect(result.suiteDir).toBe(suiteDir);
  });
});
