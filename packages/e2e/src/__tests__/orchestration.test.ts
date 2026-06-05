/**
 * src/index.ts (runE2eTest) 오케스트레이션 단위 테스트 (mock 주입)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
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

vi.mock("../agent/prompt.js", () => ({
  buildAgentPrompt: vi.fn().mockReturnValue("test prompt"),
}));

vi.mock("@karax/doctor", () => ({
  detectAndroidSdkPath: vi.fn().mockResolvedValue("/sdk"),
}));

import { createDeviceManager } from "../device/index.js";
import { selectBuilder } from "../build/index.js";
import { runAgent } from "../agent/runner.js";
import { runE2eTest } from "../index.js";

const mockCreateDeviceManager = vi.mocked(createDeviceManager);
const mockSelectBuilder = vi.mocked(selectBuilder);
const mockRunAgent = vi.mocked(runAgent);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
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
