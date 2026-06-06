/**
 * src/index.ts (runE2eTest) 오케스트레이션 단위 테스트 (mock 주입)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { AppMap } from "@karax/core";
import type { AppMapGenerator } from "../appmap/sessionAppMap.js";
import { E2eError } from "../types.js";

// 모든 외부 의존 mock
vi.mock("../device/index.js", () => ({
  createDeviceManager: vi.fn(),
}));

vi.mock("../build/index.js", () => ({
  selectBuilder: vi.fn(),
}));

vi.mock("../agent/runner.js", () => ({
  runAgent: vi.fn(),
}));

vi.mock("../agent/args.js", () => ({
  buildAgentInvocation: vi.fn().mockReturnValue({ bin: "claude", args: [], env: {} }),
}));

vi.mock("../agent/budget.js", () => ({
  computeBudget: vi.fn().mockReturnValue({ maxSteps: 20, timeoutMs: 900_000 }),
}));

vi.mock("../agent/prompt.js", () => ({
  buildAgentPrompt: vi.fn().mockReturnValue("test prompt"),
}));

vi.mock("@karax/doctor", () => ({
  detectAndroidSdkPath: vi.fn().mockResolvedValue("/sdk"),
}));

// AppMap 생성 mock (sessionAppMap 모듈)
vi.mock("../appmap/sessionAppMap.js", () => ({
  generateAppMapForSession: vi.fn(),
}));

import { createDeviceManager } from "../device/index.js";
import { selectBuilder } from "../build/index.js";
import { runAgent } from "../agent/runner.js";
import { buildAgentPrompt } from "../agent/prompt.js";
import { generateAppMapForSession } from "../appmap/sessionAppMap.js";
import { computeBudget } from "../agent/budget.js";
import { runE2eTest } from "../index.js";

const mockCreateDeviceManager = vi.mocked(createDeviceManager);
const mockSelectBuilder = vi.mocked(selectBuilder);
const mockRunAgent = vi.mocked(runAgent);
const mockBuildAgentPrompt = vi.mocked(buildAgentPrompt);
const mockGenerateAppMapForSession = vi.mocked(generateAppMapForSession);
const mockComputeBudget = vi.mocked(computeBudget);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  // 기본값: AppMap 생성 실패(null 반환) — 각 테스트에서 필요 시 override
  mockGenerateAppMapForSession.mockRejectedValue(new Error("AppMap 미설정"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-orch-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMockDeviceManager(deviceId = "emulator-5554") {
  return {
    platform: "android" as const,
    list: vi.fn().mockResolvedValue([]),
    ensureBooted: vi.fn().mockResolvedValue({
      id: deviceId,
      name: deviceId,
      platform: "android",
      isEmulator: true,
      isBooted: true,
    }),
    install: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockBuilder(appId = "com.example.app", artifactPath = "/tmp/app.apk") {
  return {
    framework: "flutter",
    platform: "android" as const,
    build: vi.fn().mockResolvedValue({ appId, artifactPath }),
  };
}

describe("runE2eTest", () => {
  it("pass 케이스: report.json과 report.md를 생성한다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [{ index: 1, description: "탭", status: "pass" }],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      agent: "claude",
      outDir: tmpDir,
    });

    expect(result.outcome).toBe("pass");
    expect(fs.existsSync(result.reportJsonPath)).toBe(true);
    expect(fs.existsSync(result.reportMdPath)).toBe(true);
  });

  it("fail 케이스: outcome이 fail로 기록된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "fail",
      summary: "실패",
      steps: [],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.outcome).toBe("fail");
  });

  it("E2eError 전파: 빌드 실패 시 에러 outcome으로 report 생성", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue({
      framework: "flutter",
      platform: "android" as const,
      build: vi.fn().mockRejectedValue(new E2eError("BUILD_FAILED", "빌드 실패")),
    } as ReturnType<typeof selectBuilder>);

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.outcome).toBe("error");
  });

  it("keepBooted=false 이면 shutdown이 호출된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      keepBooted: false,
    });

    expect(mockManager.shutdown).toHaveBeenCalled();
  });

  it("keepBooted=true 이면 shutdown이 호출되지 않는다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      keepBooted: true,
    });

    expect(mockManager.shutdown).not.toHaveBeenCalled();
  });

  // ── AppMap 생성 + 프롬프트 주입 테스트 ─────────────────────────────────────

  /** 테스트용 더미 AppMap 성공 generator */
  function makeSuccessGenerator(appMap: AppMap): AppMapGenerator {
    return vi.fn().mockResolvedValue({ appMap, writtenPaths: ["/tmp/appmap/mockapp_map_1.md"] });
  }

  /** 테스트용 실패 generator */
  function makeFailingGenerator(): AppMapGenerator {
    return vi.fn().mockRejectedValue(new Error("AppMap 생성 실패"));
  }

  it("appMapGenerator 주입 + 생성 성공 시 프롬프트에 appMapSection이 전달된다", async () => {
    const mockAppMap: AppMap = {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: "home",
      screens: [
        {
          id: "home",
          title: "홈",
          discovery: "route",
          isEntry: true,
          confidence: 0.9,
          elements: [{ type: "Button", label: "시작" }],
          outgoing: [],
        },
      ],
      edges: [],
      diagnostics: [],
      overallConfidence: 0.9,
    };

    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
    mockGenerateAppMapForSession.mockResolvedValue({
      appMap: mockAppMap,
      appMapJsonPath: "/tmp/appmap/appmap.json",
      markdownIndexPath: "/tmp/appmap/mockapp_map_1.md",
      deviceProfileId: "pixel-8",
    });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      appMapGenerator: makeSuccessGenerator(mockAppMap),
    });

    // buildAgentPrompt가 appMapSection과 함께 호출됐는지 확인
    expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ appMapSection: expect.any(String) })
    );
  });

  it("appMapGenerator 미전달 시 AppMap 생성을 시도하지 않는다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      // appMapGenerator 미전달
    });

    expect(mockGenerateAppMapForSession).not.toHaveBeenCalled();
  });

  it("appMapGenerator 주입 + 생성 실패 시 테스트가 계속 진행된다(비차단)", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
    mockGenerateAppMapForSession.mockRejectedValue(new Error("AppMap 생성 실패"));

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      appMapGenerator: makeFailingGenerator(),
    });

    // 에러로 종료되지 않고 pass로 완료
    expect(result.outcome).toBe("pass");
  });

  it("appMapGenerator 주입 + 생성 실패 시 buildAgentPrompt에 appMapSection이 없다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
    mockGenerateAppMapForSession.mockRejectedValue(new Error("실패"));

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      appMapGenerator: makeFailingGenerator(),
    });

    // appMapSection 없이 buildAgentPrompt 호출
    const callArg = mockBuildAgentPrompt.mock.calls[0][0];
    expect(callArg).not.toHaveProperty("appMapSection");
  });

  it("appMapGenerator 주입 + 성공 시 result에 appMapDir가 포함된다", async () => {
    const mockAppMap: AppMap = {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: null,
      screens: [],
      edges: [],
      diagnostics: [],
      overallConfidence: 0.5,
    };

    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
    mockGenerateAppMapForSession.mockResolvedValue({
      appMap: mockAppMap,
      appMapJsonPath: "/tmp/appmap/appmap.json",
      markdownIndexPath: null,
      deviceProfileId: "pixel-8",
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      appMapGenerator: makeSuccessGenerator(mockAppMap),
    });

    expect(result.appMapDir).toBeDefined();
  });

  it("appMapGenerator 미전달 시 result에 appMapDir가 없다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.appMapDir).toBeUndefined();
  });

  it("AppMap 생성 성공 시 buildAgentPrompt에 appMapJsonPath가 전달된다", async () => {
    const mockAppMap: AppMap = {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: "home",
      screens: [],
      edges: [],
      diagnostics: [],
      overallConfidence: 0.8,
    };

    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
    mockGenerateAppMapForSession.mockResolvedValue({
      appMap: mockAppMap,
      appMapJsonPath: "/tmp/appmap/appmap.json",
      markdownIndexPath: "/tmp/appmap/app_map_1.md",
      deviceProfileId: "pixel-8",
    });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      appMapGenerator: vi.fn().mockResolvedValue({ appMap: mockAppMap, writtenPaths: [] }),
    });

    expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ appMapJsonPath: "/tmp/appmap/appmap.json" })
    );
  });

  it("AppMap 생성 실패 시 buildAgentPrompt에 appMapJsonPath가 없다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
    mockGenerateAppMapForSession.mockRejectedValue(new Error("생성 실패"));

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      appMapGenerator: vi.fn().mockRejectedValue(new Error("실패")),
    });

    const callArg = mockBuildAgentPrompt.mock.calls[0][0];
    expect(callArg).not.toHaveProperty("appMapJsonPath");
  });

  // ── budget 자동 조정 ────────────────────────────────────────────────

  describe("budget 자동 조정", () => {
    it("AppMap 화면 수가 computeBudget에 전달된다", async () => {
      const mockAppMap = {
        schemaVersion: "appmap/2" as const,
        appName: "TestApp",
        framework: "flutter" as const,
        entryScreenId: "home",
        screens: [
          { id: "s1", title: "홈", discovery: "route" as const, isEntry: true, confidence: 0.9, elements: [], outgoing: [] },
          { id: "s2", title: "설정", discovery: "route" as const, isEntry: false, confidence: 0.9, elements: [], outgoing: [] },
          { id: "s3", title: "프로필", discovery: "route" as const, isEntry: false, confidence: 0.9, elements: [], outgoing: [] },
        ],
        edges: [],
        diagnostics: [],
        overallConfidence: 0.9,
      };

      mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
      mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
      mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
      mockGenerateAppMapForSession.mockResolvedValue({
        appMap: mockAppMap,
        appMapJsonPath: "/tmp/appmap/appmap.json",
        markdownIndexPath: null,
        deviceProfileId: "pixel-8",
      });
      // budget mock: screenCount=3 exploratory=true → 기본값 20/900_000
      mockComputeBudget.mockReturnValue({ maxSteps: 20, timeoutMs: 900_000 });

      await runE2eTest({
        projectPath: tmpDir,
        platform: "android",
        outDir: tmpDir,
        appMapGenerator: vi.fn().mockResolvedValue({ appMap: mockAppMap, writtenPaths: [] }),
        // maxSteps/timeoutMs 미전달 → computeBudget에 위임
      });

      // computeBudget이 호출됐어야 한다
      expect(mockComputeBudget).toHaveBeenCalled();
      // screenCount가 AppMap 화면 수(3)로 전달됐어야 한다
      const callArg = mockComputeBudget.mock.calls[0][0];
      expect(callArg.screenCount).toBe(3);
    });

    it("AppMap 없으면 screenCount=0으로 computeBudget이 호출된다", async () => {
      mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
      mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
      mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
      mockComputeBudget.mockReturnValue({ maxSteps: 20, timeoutMs: 900_000 });

      await runE2eTest({
        projectPath: tmpDir,
        platform: "android",
        outDir: tmpDir,
        // appMapGenerator 없음 → screenCount=0
      });

      expect(mockComputeBudget).toHaveBeenCalled();
      const callArg = mockComputeBudget.mock.calls[0][0];
      expect(callArg.screenCount).toBe(0);
    });

    it("사용자 명시 maxSteps/timeoutMs가 computeBudget에 전달된다", async () => {
      mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
      mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
      mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
      mockComputeBudget.mockReturnValue({ maxSteps: 42, timeoutMs: 1_234_567 });

      await runE2eTest({
        projectPath: tmpDir,
        platform: "android",
        outDir: tmpDir,
        maxSteps: 42,
        timeoutMs: 1_234_567,
      });

      const callArg = mockComputeBudget.mock.calls[0][0];
      expect(callArg.userMaxSteps).toBe(42);
      expect(callArg.userTimeoutMs).toBe(1_234_567);
    });

    it("computeBudget 반환값이 runAgent timeout에 적용된다", async () => {
      const mockBuildAgentInvocation = vi.mocked(
        (await import("../agent/args.js")).buildAgentInvocation
      );
      const mockRunAgentFn = vi.mocked(runAgent);

      mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
      mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
      mockRunAgentFn.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
      mockComputeBudget.mockReturnValue({ maxSteps: 35, timeoutMs: 1_500_000 });

      await runE2eTest({
        projectPath: tmpDir,
        platform: "android",
        outDir: tmpDir,
      });

      // runAgent의 3번째 인자 options.timeoutMs가 1_500_000이어야 한다
      const runAgentCallArgs = mockRunAgentFn.mock.calls[0];
      expect(runAgentCallArgs[2]).toMatchObject({ timeoutMs: 1_500_000 });
    });

    it("computeBudget 반환값 maxSteps가 buildAgentPrompt에 전달된다", async () => {
      mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
      mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
      mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });
      mockComputeBudget.mockReturnValue({ maxSteps: 55, timeoutMs: 900_000 });

      await runE2eTest({
        projectPath: tmpDir,
        platform: "android",
        outDir: tmpDir,
      });

      expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ maxSteps: 55 })
      );
    });
  });

  // ── M7: qualityWarnings / findings evidence sanitize / visitedScreens 교집합 ──

  it("screenshot 없는 non-skip 스텝이 있으면 qualityWarnings가 생성된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [
        { index: 1, description: "탭", status: "pass", screenshot: "step_1.png" },
        { index: 2, description: "스크린샷 없는 스텝", status: "pass" }, // screenshot 없음
        { index: 3, description: "건너뜀", status: "skip" }, // skip은 제외
        { index: 4, description: "fail 스텝", status: "fail" }, // screenshot 없음
      ],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.qualityWarnings).toBeDefined();
    expect(result.qualityWarnings!.length).toBeGreaterThan(0);
    // 스텝 2, 4에 경고가 있어야 함
    const warnings = result.qualityWarnings!;
    expect(warnings.some((w) => w.includes("2"))).toBe(true);
    expect(warnings.some((w) => w.includes("4"))).toBe(true);
    // 스텝 3(skip)은 경고 없어야 함
    expect(warnings.some((w) => /스텝 3|step 3/i.test(w))).toBe(false);
  });

  it("모든 non-skip 스텝에 screenshot이 있으면 qualityWarnings가 비어있거나 없다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [
        { index: 1, description: "탭", status: "pass", screenshot: "step_1.png" },
        { index: 2, description: "확인", status: "pass", screenshot: "step_2.png" },
      ],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    // 경고 없거나 빈 배열
    expect(result.qualityWarnings == null || result.qualityWarnings.length === 0).toBe(true);
  });

  it("findings의 evidence 경로가 path traversal이면 evidence 필드가 제거된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "fail",
      summary: "이슈 발견",
      steps: [],
      findings: [
        {
          id: "f1",
          severity: "major",
          category: "layout-overflow",
          description: "텍스트 잘림",
          evidence: "step_1.png", // 정상
        },
        {
          id: "f2",
          severity: "minor",
          category: "other",
          description: "사소한 문제",
          evidence: "../../etc/passwd", // path traversal
        },
        {
          id: "f3",
          severity: "major",
          category: "visual-glitch",
          description: "시각적 결함",
          evidence: "/etc/shadow", // 절대경로
        },
      ],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.findings).toBeDefined();
    const f1 = result.findings!.find((f) => f.id === "f1");
    const f2 = result.findings!.find((f) => f.id === "f2");
    const f3 = result.findings!.find((f) => f.id === "f3");

    expect(f1?.evidence).toBeDefined(); // 정상 경로는 유지
    expect(f2?.evidence).toBeUndefined(); // 탈출 경로는 제거
    expect(f3?.evidence).toBeUndefined(); // 절대경로는 제거
  });

  it("AppMap이 있을 때 visitedScreens는 AppMap screen id 집합과 교집합만 유지된다", async () => {
    const mockAppMap = {
      schemaVersion: "appmap/2" as const,
      appName: "TestApp",
      framework: "flutter" as const,
      entryScreenId: "home",
      screens: [
        { id: "home", title: "홈", discovery: "route" as const, isEntry: true, confidence: 0.9, elements: [], outgoing: [] },
        { id: "detail", title: "상세", discovery: "route" as const, isEntry: false, confidence: 0.9, elements: [], outgoing: [] },
      ],
      edges: [],
      diagnostics: [],
      overallConfidence: 0.9,
    };

    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["home", "phantom-screen", "detail", "hallucinated-id"], // 환각 포함
    });
    mockGenerateAppMapForSession.mockResolvedValue({
      appMap: mockAppMap,
      appMapJsonPath: "/tmp/appmap/appmap.json",
      markdownIndexPath: null,
      deviceProfileId: "pixel-8",
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      appMapGenerator: vi.fn().mockResolvedValue({ appMap: mockAppMap, writtenPaths: [] }),
    });

    expect(result.visitedScreens).toBeDefined();
    // AppMap에 있는 id만 유지
    expect(result.visitedScreens).toContain("home");
    expect(result.visitedScreens).toContain("detail");
    // 환각 id는 제거
    expect(result.visitedScreens).not.toContain("phantom-screen");
    expect(result.visitedScreens).not.toContain("hallucinated-id");
  });

  it("AppMap이 없을 때 visitedScreens는 그대로 유지된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["home", "settings"],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      // AppMap 없음
    });

    expect(result.visitedScreens).toEqual(["home", "settings"]);
  });

  // ── 항목 3: visitedScreens 형식 검증 (AppMap 없을 때 기본 필터) ──

  it("visitedScreens에서 빈 문자열이 제거된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["home", "", "settings", ""],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.visitedScreens).not.toContain("");
    expect(result.visitedScreens).toContain("home");
    expect(result.visitedScreens).toContain("settings");
  });

  it("visitedScreens에서 길이 100 초과 id가 제거된다", async () => {
    const longId = "a".repeat(101);
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["home", longId, "settings"],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.visitedScreens).not.toContain(longId);
    expect(result.visitedScreens).toContain("home");
    expect(result.visitedScreens).toContain("settings");
  });

  it("visitedScreens에서 제어문자 포함 id가 제거된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["home", "bad\x00id", "set\x1fting", "detail\x7f"],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.visitedScreens).not.toContain("bad\x00id");
    expect(result.visitedScreens).not.toContain("set\x1fting");
    expect(result.visitedScreens).not.toContain("detail\x7f");
    expect(result.visitedScreens).toContain("home");
  });

  it("visitedScreens에서 중복이 제거된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["home", "settings", "home", "detail", "settings"],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.visitedScreens).toBeDefined();
    const unique = new Set(result.visitedScreens);
    expect(unique.size).toBe(result.visitedScreens!.length);
    expect(result.visitedScreens).toContain("home");
    expect(result.visitedScreens).toContain("settings");
    expect(result.visitedScreens).toContain("detail");
  });

  it("AppMap 없을 때도 visitedScreens 기본 형식 검증이 동작한다", async () => {
    const longId = "b".repeat(101);
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["valid", "", longId, "also-valid", "valid"], // 빈 문자열 + 초장문 + 중복
    });
    // appMapGenerator 없음 → AppMap 없는 경로

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.visitedScreens).not.toContain("");
    expect(result.visitedScreens).not.toContain(longId);
    // 중복 제거
    const validOccurrences = result.visitedScreens!.filter((id) => id === "valid");
    expect(validOccurrences).toHaveLength(1);
    expect(result.visitedScreens).toContain("also-valid");
  });

  it("path traversal 탈출 경로가 포함된 step은 screenshot 필드가 제거된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [
        { index: 1, description: "정상 스텝", status: "pass", screenshot: "step1.png" },
        { index: 2, description: "탈출 시도", status: "pass", screenshot: "../../etc/passwd" },
        { index: 3, description: "절대경로 시도", status: "pass", screenshot: "/etc/shadow" },
      ],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    // 탈출 경로 step의 screenshot 필드는 제거되어야 한다
    const step2 = result.steps.find((s) => s.index === 2);
    const step3 = result.steps.find((s) => s.index === 3);
    expect(step2?.screenshot).toBeUndefined();
    expect(step3?.screenshot).toBeUndefined();

    // 정상 경로 step의 screenshot은 유지된다
    const step1 = result.steps.find((s) => s.index === 1);
    expect(step1?.screenshot).toBeDefined();

    // 스텝 자체는 유지된다 (3개 모두)
    expect(result.steps).toHaveLength(3);

    // report.json 에도 탈출 경로가 없어야 한다
    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      steps: Array<{ index: number; screenshot?: string }>;
    };
    const reportStep2 = reportJson.steps.find((s) => s.index === 2);
    const reportStep3 = reportJson.steps.find((s) => s.index === 3);
    expect(reportStep2?.screenshot).toBeUndefined();
    expect(reportStep3?.screenshot).toBeUndefined();
  });
});
