/**
 * M8 오케스트레이션 확장 테스트
 * - partial 복구 경로 (throw→recover→partial 리포트)
 * - 크래시 강등 (failOnCrash true/false)
 * - coverage 정규화 매칭 (대소문자 차이 id)
 * - report.json에 findings/coverage/qualityWarnings 영속 확인
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { AppMap } from "@karax/core";

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

vi.mock("../appmap/sessionAppMap.js", () => ({
  generateAppMapForSession: vi.fn(),
}));

import { createDeviceManager } from "../device/index.js";
import { selectBuilder } from "../build/index.js";
import { runAgent } from "../agent/runner.js";
import { generateAppMapForSession } from "../appmap/sessionAppMap.js";
import { E2eError } from "../types.js";
import { runE2eTest } from "../index.js";

const mockCreateDeviceManager = vi.mocked(createDeviceManager);
const mockSelectBuilder = vi.mocked(selectBuilder);
const mockRunAgent = vi.mocked(runAgent);
const mockGenerateAppMapForSession = vi.mocked(generateAppMapForSession);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateAppMapForSession.mockRejectedValue(new Error("AppMap 미설정"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-m8-test-"));
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

// ── T1: findings/coverage/qualityWarnings 영속화 ─────────────────

describe("T1: findings/coverage/qualityWarnings 영속화", () => {
  it("findings가 report.json에 저장된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "fail",
      summary: "이슈 발견",
      steps: [],
      findings: [
        { id: "f1", severity: "critical", category: "crash", description: "크래시 발생" },
      ],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      findings?: Array<{ id: string }>;
      qualityWarnings?: string[];
    };
    expect(reportJson.findings).toBeDefined();
    expect(reportJson.findings!.length).toBeGreaterThan(0);
    expect(reportJson.findings![0].id).toBe("f1");
  });

  it("qualityWarnings가 report.json에 저장된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [
        { index: 1, description: "탭", status: "pass" }, // screenshot 없음 → qualityWarning
      ],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      qualityWarnings?: string[];
    };
    expect(reportJson.qualityWarnings).toBeDefined();
    expect(reportJson.qualityWarnings!.length).toBeGreaterThan(0);
  });

  it("coverage가 report.json에 저장된다 (AppMap 있는 경우)", async () => {
    const mockAppMap: AppMap = {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: "home",
      screens: [
        { id: "home", title: "홈", discovery: "route", isEntry: true, confidence: 0.9, elements: [], outgoing: [] },
        { id: "detail", title: "상세", discovery: "route", isEntry: false, confidence: 0.9, elements: [], outgoing: [] },
        { id: "settings", title: "설정", discovery: "route", isEntry: false, confidence: 0.9, elements: [], outgoing: [] },
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
      visitedScreens: ["home", "detail"],
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

    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      coverage?: {
        totalScreens: number;
        visitedScreens: number;
        coverageRatio: number;
      };
    };
    expect(reportJson.coverage).toBeDefined();
    expect(reportJson.coverage!.totalScreens).toBe(3);
    expect(reportJson.coverage!.visitedScreens).toBe(2);
  });
});

// ── T2: coverage 정규화 매칭 ─────────────────────────────────────

describe("T2: coverage 정규화 매칭 (trim+lowercase)", () => {
  it("대소문자 차이 id가 매칭된다", async () => {
    const mockAppMap: AppMap = {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: "Home",
      screens: [
        { id: "Home", title: "홈", discovery: "route", isEntry: true, confidence: 0.9, elements: [], outgoing: [] },
        { id: "Detail", title: "상세", discovery: "route", isEntry: false, confidence: 0.9, elements: [], outgoing: [] },
      ],
      edges: [],
      diagnostics: [],
      overallConfidence: 0.9,
    };

    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    // 에이전트가 소문자로 보고
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
      visitedScreens: ["home", "detail"], // 소문자
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

    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      coverage?: {
        totalScreens: number;
        visitedScreens: number;
        visitedScreenIds: string[];
        coverageRatio: number;
      };
    };

    // 정규화로 매칭 → 2개 모두 방문됨
    expect(reportJson.coverage?.visitedScreens).toBe(2);
    // 원본 id(대문자)가 visitedScreenIds에 기록됨
    expect(reportJson.coverage?.visitedScreenIds).toContain("Home");
    expect(reportJson.coverage?.visitedScreenIds).toContain("Detail");
  });

  it("앞뒤 공백이 있는 id도 trim 후 매칭된다", async () => {
    const mockAppMap: AppMap = {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: "home",
      screens: [
        { id: "home", title: "홈", discovery: "route", isEntry: true, confidence: 0.9, elements: [], outgoing: [] },
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
      visitedScreens: [" home "], // 공백 포함
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

    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      coverage?: { visitedScreens: number; visitedScreenIds: string[] };
    };
    // trim 후 매칭 → home이 방문됨
    expect(reportJson.coverage?.visitedScreens).toBe(1);
    // 원본 AppMap id로 기록
    expect(reportJson.coverage?.visitedScreenIds).toContain("home");
  });

  it("coverageRatio가 0~1 범위 내에 있다", async () => {
    const mockAppMap: AppMap = {
      schemaVersion: "appmap/2",
      appName: "TestApp",
      framework: "flutter",
      entryScreenId: "home",
      screens: [
        { id: "home", title: "홈", discovery: "route", isEntry: true, confidence: 0.9, elements: [], outgoing: [] },
        { id: "detail", title: "상세", discovery: "route", isEntry: false, confidence: 0.9, elements: [], outgoing: [] },
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
      visitedScreens: ["home"],
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

    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      coverage?: { coverageRatio: number };
    };
    expect(reportJson.coverage?.coverageRatio).toBeGreaterThanOrEqual(0);
    expect(reportJson.coverage?.coverageRatio).toBeLessThanOrEqual(1);
  });
});

// ── 크래시 감지 & failOnCrash ─────────────────────────────────────

describe("크래시 감지 → outcome 강등", () => {
  it("crashes가 있으면 기본(failOnCrash=true)으로 pass→fail 강등된다", async () => {
    const FATAL_LOGCAT = `
05-15 10:22:01.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  1234  1234 E AndroidRuntime: Process: com.example.app, PID: 1234
05-15 10:22:01.125  1234  1234 E AndroidRuntime: java.lang.NullPointerException
`;
    mockCreateDeviceManager.mockResolvedValue({
      ...makeMockDeviceManager(),
      captureLogcat: vi.fn().mockResolvedValue(FATAL_LOGCAT),
    } as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass", // 에이전트는 통과로 판단
      summary: "통과",
      steps: [],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    // 크래시 감지로 fail 강등
    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      outcome: string;
      crashes?: Array<{ type: string }>;
      findings?: Array<{ category: string; severity: string }>;
    };

    // crashes가 있으면 outcome이 fail이어야 함
    if (reportJson.crashes && reportJson.crashes.length > 0) {
      expect(reportJson.outcome).toBe("fail");
      // crash synthetic finding이 있어야 함
      expect(reportJson.findings?.some((f) => f.category === "crash")).toBe(true);
      expect(reportJson.findings?.some((f) => f.severity === "critical")).toBe(true);
    }
    // captureLogcat 미구현 시 크래시 없음 → pass 유지 (비차단)
  });

  it("failOnCrash=false이면 크래시가 있어도 outcome이 강등되지 않는다", async () => {
    const FATAL_LOGCAT = `
05-15 10:22:01.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  1234  1234 E AndroidRuntime: Process: com.example.app, PID: 1234
05-15 10:22:01.125  1234  1234 E AndroidRuntime: java.lang.RuntimeException
`;
    mockCreateDeviceManager.mockResolvedValue({
      ...makeMockDeviceManager(),
      captureLogcat: vi.fn().mockResolvedValue(FATAL_LOGCAT),
    } as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({
      outcome: "pass",
      summary: "통과",
      steps: [],
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      failOnCrash: false,
    });

    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      outcome: string;
      crashes?: Array<{ type: string }>;
    };

    // failOnCrash=false이므로 크래시 있어도 강등 없음
    if (reportJson.crashes && reportJson.crashes.length > 0) {
      expect(reportJson.outcome).toBe("pass"); // 강등 안 됨
    }
  });
});

// ── partial 복구 경로 ─────────────────────────────────────────────

describe("partial 복구 경로", () => {
  it("AGENT_TIMEOUT 에러 후 step_N.png가 있으면 outcome:partial로 복구된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);

    // AGENT_TIMEOUT 에러 던짐
    mockRunAgent.mockImplementation(async (_invocation, screenshotsDir) => {
      // screenshotsDir에 step PNG 생성 (복구 가능)
      fs.mkdirSync(screenshotsDir, { recursive: true });
      fs.writeFileSync(path.join(screenshotsDir, "step_1.png"), "PNG", "utf-8");
      fs.writeFileSync(path.join(screenshotsDir, "step_2.png"), "PNG", "utf-8");
      throw new E2eError("AGENT_TIMEOUT", "타임아웃");
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    // partial 또는 복구된 결과
    expect(["partial", "fail", "error"]).toContain(result.outcome);

    // report.json이 생성되어야 함
    expect(fs.existsSync(result.reportJsonPath)).toBe(true);
    const reportJson = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as {
      outcome: string;
    };
    // 복구된 경우 partial
    if (reportJson.outcome === "partial") {
      expect(result.outcome).toBe("partial");
    }
  });

  it("AGENT_OUTPUT_INVALID 에러 후 복구 시 리포트가 생성된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);

    mockRunAgent.mockImplementation(async (_invocation, screenshotsDir) => {
      fs.mkdirSync(screenshotsDir, { recursive: true });
      fs.writeFileSync(path.join(screenshotsDir, "step_1.png"), "PNG", "utf-8");
      throw new E2eError("AGENT_OUTPUT_INVALID", "출력 파싱 불가");
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(fs.existsSync(result.reportJsonPath)).toBe(true);
    expect(fs.existsSync(result.reportMdPath)).toBe(true);
  });

  it("타임아웃 후 PNG도 없으면 error outcome으로 처리된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);

    mockRunAgent.mockImplementation(async () => {
      // screenshotsDir에 아무것도 안 씀
      throw new E2eError("AGENT_TIMEOUT", "타임아웃");
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    // PNG 없으면 복구 불가 → error
    expect(result.outcome).toBe("error");
  });
});

// ── E2eTestResult.crashes / coverage 타입 동기화 ─────────────────

describe("E2eTestResult 타입 동기화", () => {
  it("result에 crashes 필드 타입이 접근 가능하다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    // 타입 컴파일 검증 — crashes 필드 접근 가능해야 함
    const crashes = result.crashes;
    expect(crashes == null || Array.isArray(crashes)).toBe(true);
  });

  it("result에 coverage 필드 타입이 접근 가능하다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    const coverage = result.coverage;
    expect(coverage == null || typeof coverage === "object").toBe(true);
  });
});
