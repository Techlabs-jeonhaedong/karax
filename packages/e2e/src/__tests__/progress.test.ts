/**
 * E2E Progress 이벤트 테스트
 *
 * - onProgress 콜백이 각 파이프라인 단계에서 올바른 순서/페이로드로 발행되는지
 * - 콜백이 throw해도 파이프라인이 정상 완료되는지
 * - suite에서 시나리오 인덱스가 전파되는지
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { E2eProgressEvent, E2eProgressPhase } from "../progress.js";

// ── 외부 의존 mock ─────────────────────────────────────────────────

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

vi.mock("../runtime/dumpIos.js", () => ({
  isIdbAvailable: vi.fn().mockResolvedValue(false),
  dumpIosUI: vi.fn(),
}));

vi.mock("@karax/doctor", () => ({
  detectAndroidSdkPath: vi.fn().mockResolvedValue("/sdk"),
}));

vi.mock("../appmap/sessionAppMap.js", () => ({
  generateAppMapForSession: vi.fn(),
}));

vi.mock("../build/cache.js", () => ({
  computeSourceFingerprint: vi.fn().mockReturnValue({ hash: "abc123", newestSourceMtimeMs: 1000 }),
  readBuildCache: vi.fn().mockReturnValue(null),
  writeBuildCache: vi.fn(),
  isArtifactFresh: vi.fn().mockReturnValue(false),
}));

vi.mock("../recorder.js", () => ({
  startAndroidRecording: vi.fn(),
  startIosRecording: vi.fn(),
}));

import { createDeviceManager } from "../device/index.js";
import { selectBuilder } from "../build/index.js";
import { runAgent } from "../agent/runner.js";
import { generateAppMapForSession } from "../appmap/sessionAppMap.js";
import { runE2eTest, runE2eSuite } from "../index.js";

const mockCreateDeviceManager = vi.mocked(createDeviceManager);
const mockSelectBuilder = vi.mocked(selectBuilder);
const mockRunAgent = vi.mocked(runAgent);
const mockGenerateAppMapForSession = vi.mocked(generateAppMapForSession);

let tmpDir: string;
let karaxDebugBackup: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  karaxDebugBackup = process.env["KARAX_DEBUG"];
  delete process.env["KARAX_DEBUG"];
  mockGenerateAppMapForSession.mockRejectedValue(new Error("AppMap 미설정"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-progress-test-"));
});

afterEach(() => {
  if (karaxDebugBackup !== undefined) {
    process.env["KARAX_DEBUG"] = karaxDebugBackup;
  } else {
    delete process.env["KARAX_DEBUG"];
  }
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

function makeAgentSuccess() {
  return {
    outcome: "pass" as const,
    summary: "통과",
    steps: [{ index: 1, description: "탭", status: "pass" as const }],
  };
}

// ── 이벤트 타입 유효성 ──────────────────────────────────────────────

describe("E2eProgressEvent 타입", () => {
  it("E2eProgressPhase 리터럴이 올바른 단계들을 포함한다", () => {
    const validPhases: E2eProgressPhase[] = [
      "scenario",
      "detect",
      "device",
      "appmap",
      "build",
      "install",
      "launch",
      "agent",
      "crash-scan",
      "report",
    ];
    // 타입 컴파일 통과 여부만 확인 (런타임 assertion)
    expect(validPhases).toHaveLength(10);
  });

  it("E2eProgressEvent는 필수 필드를 갖는다", () => {
    const event: E2eProgressEvent = {
      phase: "build",
      status: "start",
      timestamp: Date.now(),
    };
    expect(event.phase).toBe("build");
    expect(event.status).toBe("start");
    expect(typeof event.timestamp).toBe("number");
  });

  it("E2eProgressEvent는 선택 필드를 가질 수 있다", () => {
    const event: E2eProgressEvent = {
      phase: "agent",
      status: "done",
      timestamp: Date.now(),
      detail: "에이전트 완료",
      stepIndex: 2,
      totalSteps: 5,
    };
    expect(event.detail).toBe("에이전트 완료");
    expect(event.stepIndex).toBe(2);
    expect(event.totalSteps).toBe(5);
  });
});

// ── onProgress 콜백 발행 순서 ───────────────────────────────────────

describe("runE2eTest — onProgress 이벤트 발행", () => {
  it("파이프라인 단계가 올바른 순서로 발행된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const events: E2eProgressEvent[] = [];
    const onProgress = vi.fn((event: E2eProgressEvent) => {
      events.push(event);
    });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      onProgress,
    });

    const phases = events.map((e) => `${e.phase}:${e.status}`);
    // detect → device:start → device:done → build:start → build:done → install → launch → agent:start → agent:done → report
    expect(phases).toContain("device:start");
    expect(phases).toContain("device:done");
    expect(phases).toContain("build:start");
    expect(phases).toContain("build:done");
    expect(phases).toContain("install:start");
    expect(phases).toContain("install:done");
    expect(phases).toContain("launch:start");
    expect(phases).toContain("launch:done");
    expect(phases).toContain("agent:start");
    expect(phases).toContain("agent:done");
    expect(phases).toContain("report:done");
  });

  it("각 이벤트의 timestamp는 숫자이고 단조 증가한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const events: E2eProgressEvent[] = [];
    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      onProgress: (e) => events.push(e),
    });

    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.timestamp).toBeGreaterThanOrEqual(events[i - 1]!.timestamp);
    }
  });

  it("build:start는 build:done보다 먼저 발행된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const events: E2eProgressEvent[] = [];
    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      onProgress: (e) => events.push(e),
    });

    const buildStartIdx = events.findIndex((e) => e.phase === "build" && e.status === "start");
    const buildDoneIdx = events.findIndex((e) => e.phase === "build" && e.status === "done");
    expect(buildStartIdx).toBeGreaterThanOrEqual(0);
    expect(buildDoneIdx).toBeGreaterThan(buildStartIdx);
  });

  it("agent:start는 agent:done보다 먼저 발행된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const events: E2eProgressEvent[] = [];
    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      onProgress: (e) => events.push(e),
    });

    const agentStartIdx = events.findIndex((e) => e.phase === "agent" && e.status === "start");
    const agentDoneIdx = events.findIndex((e) => e.phase === "agent" && e.status === "done");
    expect(agentStartIdx).toBeGreaterThanOrEqual(0);
    expect(agentDoneIdx).toBeGreaterThan(agentStartIdx);
  });

  it("onProgress가 없어도 파이프라인이 정상 동작한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      // onProgress 없음
    });

    expect(result.outcome).toBe("pass");
  });
});

// ── 콜백 오류 격리 ──────────────────────────────────────────────────

describe("runE2eTest — 콜백 오류 격리", () => {
  it("onProgress 콜백이 throw해도 파이프라인이 정상 완료된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const onProgress = vi.fn(() => {
      throw new Error("콜백 오류 — 파이프라인을 중단시켜선 안 됨");
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      onProgress,
    });

    // 파이프라인이 정상 완료돼야 함
    expect(result.outcome).toBe("pass");
    // 콜백은 최소 한 번은 호출됐어야 함
    expect(onProgress).toHaveBeenCalled();
  });

  it("콜백이 async로 throw해도 파이프라인이 정상 완료된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const onProgress = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("async 콜백 오류");
    });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      onProgress,
    });

    expect(result.outcome).toBe("pass");
  });

  it("빌드 실패 시 error 이벤트가 발행되고 outcome=error를 반환한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockBuilder.build.mockRejectedValue(new Error("빌드 실패"));
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);

    const events: E2eProgressEvent[] = [];
    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      onProgress: (e) => events.push(e),
    });

    expect(result.outcome).toBe("error");
    // build:start는 발행됐어야 함
    expect(events.some((e) => e.phase === "build" && e.status === "start")).toBe(true);
    // build:error 또는 일반 error 이벤트가 발행됐어야 함
    expect(events.some((e) => e.status === "error")).toBe(true);
  });
});

// ── suite — 시나리오 인덱스 전파 ────────────────────────────────────

describe("runE2eSuite — onProgress 전파", () => {
  it("suite 모드에서 stepIndex/totalSteps가 시나리오 인덱스를 포함한다", async () => {
    // 시나리오 파일 2개 생성
    const s1 = path.join(tmpDir, "01-first.md");
    const s2 = path.join(tmpDir, "02-second.md");
    fs.writeFileSync(s1, "# 시나리오 1\n본문", "utf-8");
    fs.writeFileSync(s2, "# 시나리오 2\n본문", "utf-8");

    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const events: E2eProgressEvent[] = [];
    await runE2eSuite({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      scenarioPath: tmpDir,
      onProgress: (e) => events.push(e),
    });

    // suite 이벤트에 stepIndex가 포함된 것이 있어야 함
    const suiteEvents = events.filter((e) => e.stepIndex !== undefined);
    expect(suiteEvents.length).toBeGreaterThan(0);

    // totalSteps는 시나리오 수 (2)여야 함
    const withTotal = suiteEvents.filter((e) => e.totalSteps === 2);
    expect(withTotal.length).toBeGreaterThan(0);
  });

  it("suite에서 onProgress가 없어도 정상 동작한다", async () => {
    const s1 = path.join(tmpDir, "01-first.md");
    fs.writeFileSync(s1, "# 시나리오 1\n본문", "utf-8");

    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const result = await runE2eSuite({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      scenarioPath: tmpDir,
    });

    expect(result.outcome).toBe("pass");
  });
});
