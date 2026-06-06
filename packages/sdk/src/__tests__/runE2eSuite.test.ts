/**
 * sdk/runE2eSuite — 재노출 + 기본 AppMapGenerator 주입 동작 테스트
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// @karax/e2e 동적 import mock
vi.mock("@karax/e2e", () => ({
  runE2eTest: vi.fn().mockResolvedValue({
    outcome: "pass",
    sessionDir: "/tmp/session",
    reportJsonPath: "/tmp/session/report.json",
    reportMdPath: "/tmp/session/report.md",
    screenshotsDir: "/tmp/session/screenshots",
    summary: "통과",
    steps: [],
  }),
  runE2eSuite: vi.fn().mockResolvedValue({
    outcome: "pass",
    results: [
      {
        scenarioPath: "/tmp/a.md",
        result: {
          outcome: "pass",
          sessionDir: "/tmp/session",
          reportJsonPath: "/tmp/session/report.json",
          reportMdPath: "/tmp/session/report.md",
          screenshotsDir: "/tmp/session/screenshots",
          summary: "통과",
          steps: [],
        },
      },
    ],
    summary: "1/1 pass",
  }),
}));

// appMap 모듈 mock
vi.mock("../appMap.js", () => ({
  generateAppMap: vi.fn().mockResolvedValue({
    appMap: {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: null,
      screens: [],
      edges: [],
      diagnostics: [],
      overallConfidence: 0.5,
    },
    documents: [],
    writtenPaths: [],
  }),
}));

import { runE2eSuite } from "../index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sdk runE2eSuite — 재노출 동작", () => {
  it("runE2eSuite가 sdk에서 export된다", () => {
    expect(runE2eSuite).toBeDefined();
    expect(typeof runE2eSuite).toBe("function");
  });

  it("appMapGenerator 미전달 시 e2e.runE2eSuite에 appMapGenerator가 자동 주입된다", async () => {
    const { runE2eSuite: e2eRunE2eSuite } = await import("@karax/e2e");

    await runE2eSuite({
      projectPath: "/tmp/project",
      platform: "android",
      scenarioPath: "/tmp/scenarios",
    });

    expect(e2eRunE2eSuite).toHaveBeenCalledWith(
      expect.objectContaining({ appMapGenerator: expect.any(Function) })
    );
  });

  it("appMapGenerator 직접 전달 시 그대로 전달된다", async () => {
    const { runE2eSuite: e2eRunE2eSuite } = await import("@karax/e2e");
    const customGenerator = vi.fn().mockResolvedValue({ appMap: {} as never, writtenPaths: [] });

    await runE2eSuite({
      projectPath: "/tmp/project",
      platform: "android",
      scenarioPath: "/tmp/scenarios",
      appMapGenerator: customGenerator,
    });

    expect(e2eRunE2eSuite).toHaveBeenCalledWith(
      expect.objectContaining({ appMapGenerator: customGenerator })
    );
  });

  it("suite 결과를 그대로 반환한다", async () => {
    const result = await runE2eSuite({
      projectPath: "/tmp/project",
      platform: "android",
      scenarioPath: "/tmp/scenarios",
    });

    expect(result.outcome).toBe("pass");
    expect(result.summary).toBe("1/1 pass");
    expect(result.results).toHaveLength(1);
  });
});
