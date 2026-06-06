/**
 * sdk/runE2eTest — 기본 AppMapGenerator 주입 동작 테스트
 *
 * e2e 모듈을 mock해, sdk의 runE2eTest 래퍼가
 * appMapGenerator를 올바르게 주입하는지 검증한다.
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

import { runE2eTest } from "../index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sdk runE2eTest — 기본 AppMapGenerator 주입", () => {
  it("appMapGenerator 미전달 시 e2e.runE2eTest에 appMapGenerator가 자동 주입된다", async () => {
    const { runE2eTest: e2eRunE2eTest } = await import("@karax/e2e");

    await runE2eTest({
      projectPath: "/tmp/project",
      platform: "android",
    });

    expect(e2eRunE2eTest).toHaveBeenCalledWith(
      expect.objectContaining({ appMapGenerator: expect.any(Function) })
    );
  });

  it("appMapGenerator 직접 전달 시 그대로 전달된다", async () => {
    const { runE2eTest: e2eRunE2eTest } = await import("@karax/e2e");
    const customGenerator = vi.fn().mockResolvedValue({ appMap: {} as never, writtenPaths: [] });

    await runE2eTest({
      projectPath: "/tmp/project",
      platform: "android",
      appMapGenerator: customGenerator,
    });

    expect(e2eRunE2eTest).toHaveBeenCalledWith(
      expect.objectContaining({ appMapGenerator: customGenerator })
    );
  });

  it("주입된 기본 generator 호출 시 generateAppMap을 write:true로 실행한다", async () => {
    const { runE2eTest: e2eRunE2eTest } = await import("@karax/e2e");
    const { generateAppMap } = await import("../appMap.js");

    let capturedGenerator: ((opts: { projectPath: string; framework: string; device: string; outDir: string }) => Promise<unknown>) | undefined;

    vi.mocked(e2eRunE2eTest).mockImplementationOnce(async (opts) => {
      capturedGenerator = opts.appMapGenerator as typeof capturedGenerator;
      return {
        outcome: "pass",
        sessionDir: "/tmp/session",
        reportJsonPath: "/tmp/session/report.json",
        reportMdPath: "/tmp/session/report.md",
        screenshotsDir: "/tmp/session/screenshots",
        summary: "통과",
        steps: [],
      };
    });

    await runE2eTest({
      projectPath: "/tmp/project",
      platform: "android",
    });

    // 주입된 generator를 직접 호출
    expect(capturedGenerator).toBeDefined();
    await capturedGenerator!({
      projectPath: "/tmp/project",
      framework: "flutter",
      device: "pixel-8",
      outDir: "/tmp/appmap",
    });

    expect(generateAppMap).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "/tmp/project",
        framework: "flutter",
        device: "pixel-8",
        write: true,
        outDir: "/tmp/appmap",
      })
    );
  });

  it("runE2eTest 결과를 그대로 반환한다", async () => {
    const result = await runE2eTest({
      projectPath: "/tmp/project",
      platform: "ios",
    });

    expect(result.outcome).toBe("pass");
    expect(result.summary).toBe("통과");
  });
});
