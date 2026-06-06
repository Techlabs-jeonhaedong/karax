/**
 * M11 오케스트레이션 단위 테스트
 *
 * - reuseBuild: 캐시 히트 시 builder.build 미호출
 * - noBuild: 캐시 미스 시 ARTIFACT_NOT_FOUND
 * - 기본 경로 회귀 (빌드 호출 + 캐시 기록)
 * - grantPermissions 흐름 (시나리오 permissions 선언 → install -g + pm grant)
 * - recordVideo 흐름 (start/stop, report videos 필드)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { E2eError } from "../types.js";

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

// M11: 빌드 캐시 mock
vi.mock("../build/cache.js", () => ({
  computeSourceFingerprint: vi.fn().mockReturnValue({ hash: "abc123", newestSourceMtimeMs: 1000 }),
  readBuildCache: vi.fn(),
  writeBuildCache: vi.fn(),
  isArtifactFresh: vi.fn(),
}));

// M11: recorder mock
vi.mock("../recorder.js", () => ({
  startAndroidRecording: vi.fn(),
  startIosRecording: vi.fn(),
}));

import { createDeviceManager } from "../device/index.js";
import { selectBuilder } from "../build/index.js";
import { runAgent } from "../agent/runner.js";
import { generateAppMapForSession } from "../appmap/sessionAppMap.js";
import { computeSourceFingerprint, readBuildCache, writeBuildCache, isArtifactFresh } from "../build/cache.js";
import { startAndroidRecording, startIosRecording } from "../recorder.js";
import { runE2eTest } from "../index.js";

const mockCreateDeviceManager = vi.mocked(createDeviceManager);
const mockSelectBuilder = vi.mocked(selectBuilder);
const mockRunAgent = vi.mocked(runAgent);
const mockGenerateAppMapForSession = vi.mocked(generateAppMapForSession);
const mockComputeFingerprint = vi.mocked(computeSourceFingerprint);
const mockReadBuildCache = vi.mocked(readBuildCache);
const mockWriteBuildCache = vi.mocked(writeBuildCache);
const mockIsArtifactFresh = vi.mocked(isArtifactFresh);
const mockStartAndroidRecording = vi.mocked(startAndroidRecording);
const mockStartIosRecording = vi.mocked(startIosRecording);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateAppMapForSession.mockRejectedValue(new Error("AppMap 미설정"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-m11-test-"));
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
    grantPermissions: vi.fn().mockResolvedValue(undefined),
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

// ── 기본 경로 회귀 ──────────────────────────────────────────────────

describe("기본 경로 회귀 (reuseBuild=false, noBuild=false)", () => {
  it("reuseBuild/noBuild 둘 다 false이면 항상 builder.build를 호출한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(mockBuilder.build).toHaveBeenCalledTimes(1);
  });

  it("빌드 완료 후 writeBuildCache를 호출한다 (캐시 기록)", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(mockWriteBuildCache).toHaveBeenCalledTimes(1);
  });
});

// ── reuseBuild 캐시 히트 ───────────────────────────────────────────

describe("reuseBuild=true", () => {
  it("캐시 히트 + fresh artifact이면 builder.build를 호출하지 않는다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder("/tmp/app.apk");
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    // 캐시 히트 설정
    mockReadBuildCache.mockReturnValue({
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "abc123",
      builtAtMs: 999,
    });
    mockIsArtifactFresh.mockReturnValue(true);
    mockComputeFingerprint.mockReturnValue({ hash: "abc123", newestSourceMtimeMs: 1000 });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      reuseBuild: true,
    });

    expect(mockBuilder.build).not.toHaveBeenCalled();
  });

  it("캐시 히트지만 hash 불일치이면 builder.build를 호출한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    // 캐시는 있지만 hash가 다름
    mockReadBuildCache.mockReturnValue({
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "old-hash",
      builtAtMs: 999,
    });
    mockIsArtifactFresh.mockReturnValue(true);
    mockComputeFingerprint.mockReturnValue({ hash: "new-hash", newestSourceMtimeMs: 1000 });

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      reuseBuild: true,
    });

    expect(mockBuilder.build).toHaveBeenCalledTimes(1);
  });

  it("캐시 없으면 builder.build를 호출한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    mockReadBuildCache.mockReturnValue(null);

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      reuseBuild: true,
    });

    expect(mockBuilder.build).toHaveBeenCalledTimes(1);
  });
});

// ── noBuild 캐시 미스 → ARTIFACT_NOT_FOUND ────────────────────────

describe("noBuild=true", () => {
  it("캐시 히트 + fresh 이면 빌드 없이 진행한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder("/tmp/app.apk");
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    mockReadBuildCache.mockReturnValue({
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "abc123",
      builtAtMs: 999,
    });
    mockIsArtifactFresh.mockReturnValue(true);
    mockComputeFingerprint.mockReturnValue({ hash: "abc123", newestSourceMtimeMs: 1000 });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      noBuild: true,
    });

    expect(mockBuilder.build).not.toHaveBeenCalled();
    expect(result.outcome).not.toBe("error");
  });

  it("캐시 미스이면 ARTIFACT_NOT_FOUND 에러를 반환한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    const mockBuilder = makeMockBuilder();
    mockSelectBuilder.mockReturnValue(mockBuilder as ReturnType<typeof selectBuilder>);

    mockReadBuildCache.mockReturnValue(null);

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      noBuild: true,
    });

    expect(result.outcome).toBe("error");
    // report에 ARTIFACT_NOT_FOUND가 기록됐는지 확인
    const report = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as { errorCode?: string };
    expect(report.errorCode).toBe("ARTIFACT_NOT_FOUND");
  });

  it("캐시 있지만 artifact가 fresh하지 않으면 ARTIFACT_NOT_FOUND", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);

    mockReadBuildCache.mockReturnValue({
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "abc123",
      builtAtMs: 999,
    });
    mockIsArtifactFresh.mockReturnValue(false);
    mockComputeFingerprint.mockReturnValue({ hash: "abc123", newestSourceMtimeMs: 1000 });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      noBuild: true,
    });

    expect(result.outcome).toBe("error");
    const report = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8")) as { errorCode?: string };
    expect(report.errorCode).toBe("ARTIFACT_NOT_FOUND");
  });
});

// ── grantPermissions 흐름 ─────────────────────────────────────────

describe("grantPermissions 흐름", () => {
  it("시나리오에 permissions가 있으면 grantPermissions를 호출한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    // permissions를 포함한 시나리오 파일 생성
    const scenarioPath = path.join(tmpDir, "scenario.md");
    fs.writeFileSync(scenarioPath, [
      "---",
      "permissions:",
      "  - android.permission.CAMERA",
      "  - android.permission.RECORD_AUDIO",
      "---",
      "",
      "카메라 테스트",
    ].join("\n"));

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      scenarioPath,
      grantPermissions: true,
    });

    expect(mockManager.grantPermissions).toHaveBeenCalled();
    const [, , perms] = mockManager.grantPermissions.mock.calls[0] as [string, string, string[]];
    expect(perms).toContain("android.permission.CAMERA");
  });

  it("grantPermissions=false이면 permissions 선언이 있어도 grantPermissions를 호출하지 않는다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const scenarioPath = path.join(tmpDir, "scenario.md");
    fs.writeFileSync(scenarioPath, [
      "---",
      "permissions:",
      "  - android.permission.CAMERA",
      "---",
      "",
      "테스트",
    ].join("\n"));

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      scenarioPath,
      grantPermissions: false,
    });

    expect(mockManager.grantPermissions).not.toHaveBeenCalled();
  });

  it("DeviceManager에 grantPermissions가 없어도 에러 없이 진행한다", async () => {
    const mockManager = makeMockDeviceManager();
    // grantPermissions 제거
    delete (mockManager as { grantPermissions?: unknown }).grantPermissions;
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const scenarioPath = path.join(tmpDir, "scenario.md");
    fs.writeFileSync(scenarioPath, [
      "---",
      "permissions:",
      "  - android.permission.CAMERA",
      "---",
      "",
      "테스트",
    ].join("\n"));

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      scenarioPath,
      grantPermissions: true,
    });

    expect(result.outcome).not.toBe("error");
  });
});

// ── recordVideo 흐름 ──────────────────────────────────────────────

describe("recordVideo 흐름", () => {
  it("recordVideo=true이면 launch 후 startAndroidRecording을 호출한다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const mockRecorder = { stop: vi.fn().mockResolvedValue(["/tmp/videos/rec.mp4"]) };
    mockStartAndroidRecording.mockResolvedValue(mockRecorder);

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      recordVideo: true,
    });

    expect(mockStartAndroidRecording).toHaveBeenCalledTimes(1);
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  });

  it("recordVideo=false이면 startAndroidRecording을 호출하지 않는다 (기본 경로)", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(mockStartAndroidRecording).not.toHaveBeenCalled();
  });

  it("stop() 실패해도 테스트 outcome은 정상 유지된다 (비차단)", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const mockRecorder = { stop: vi.fn().mockRejectedValue(new Error("녹화 실패")) };
    mockStartAndroidRecording.mockResolvedValue(mockRecorder);

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      recordVideo: true,
    });

    // 녹화 실패해도 테스트 결과는 pass
    expect(result.outcome).toBe("pass");
  });

  it("녹화 파일 경로가 report의 videos[]에 포함된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const mockRecorder = { stop: vi.fn().mockResolvedValue(["/tmp/videos/rec.mp4"]) };
    mockStartAndroidRecording.mockResolvedValue(mockRecorder);

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      recordVideo: true,
    });

    // E2eTestResult에 videos 필드
    expect(result.videos).toBeDefined();
    expect(result.videos!.length).toBeGreaterThan(0);
  });

  it("iOS platform이면 startIosRecording을 호출한다", async () => {
    const mockManager = {
      ...makeMockDeviceManager(),
      platform: "ios" as const,
    };
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue({
      framework: "flutter",
      platform: "ios" as const,
      build: vi.fn().mockResolvedValue({ appId: "com.example.app", artifactPath: "/tmp/app.app" }),
    } as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue(makeAgentSuccess());

    const mockRecorder = { stop: vi.fn().mockResolvedValue(["/tmp/videos/recording.mov"]) };
    mockStartIosRecording.mockResolvedValue(mockRecorder);

    await runE2eTest({
      projectPath: tmpDir,
      platform: "ios",
      outDir: tmpDir,
      recordVideo: true,
    });

    expect(mockStartIosRecording).toHaveBeenCalledTimes(1);
    expect(mockStartAndroidRecording).not.toHaveBeenCalled();
  });
});
