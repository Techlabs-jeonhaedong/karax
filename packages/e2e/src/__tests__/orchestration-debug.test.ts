/**
 * runE2eTest — debug 모드 오케스트레이션 테스트 (Phase B-3)
 *
 * 검증 항목:
 * - debug=off 시 기존 동작 불변 (debug/ 미생성, teardown 침묵)
 * - debug=on 시 manifest.json 기록, teardown.log 기록, error.json 기록
 * - report.json 스키마 불변 (debug 아티팩트는 별도 파일로만)
 * - teardown off 시 기존 침묵 그대로
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { E2eError } from "../types.js";

// 외부 의존 mock
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

import { createDeviceManager } from "../device/index.js";
import { selectBuilder } from "../build/index.js";
import { runAgent } from "../agent/runner.js";
import { generateAppMapForSession } from "../appmap/sessionAppMap.js";
import { runE2eTest } from "../index.js";

const mockCreateDeviceManager = vi.mocked(createDeviceManager);
const mockSelectBuilder = vi.mocked(selectBuilder);
const mockRunAgent = vi.mocked(runAgent);
const mockGenerateAppMapForSession = vi.mocked(generateAppMapForSession);

// stderr 스파이 — debug 테스트에서 [karax/debug] 출력이 실제 stderr로 새지 않도록 가로챔
const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

let tmpDir: string;
let karaxDebugBackup: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  // KARAX_DEBUG 환경변수 백업·제거 — 환경에 KARAX_DEBUG=1이 있어도 테스트가 결정론적이어야 함
  karaxDebugBackup = process.env["KARAX_DEBUG"];
  delete process.env["KARAX_DEBUG"];
  mockGenerateAppMapForSession.mockRejectedValue(new Error("AppMap 미설정"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-debug-orch-test-"));
});

afterEach(() => {
  // KARAX_DEBUG 복원
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

// ── B-3: debug=off 기존 동작 불변 ────────────────────────────────────

describe("runE2eTest — debug=off (기존 동작 불변)", () => {
  it("debug 옵션 없이 실행해도 result.outcome이 정상이다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(result.outcome).toBe("pass");
  });

  it("debug=false 시 sessionDir/debug/ 가 생성되지 않는다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: false,
    });

    expect(fs.existsSync(path.join(result.sessionDir, "debug"))).toBe(false);
  });

  it("debug 옵션 없을 때도 sessionDir/debug/ 가 생성되지 않는다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
    });

    expect(fs.existsSync(path.join(result.sessionDir, "debug"))).toBe(false);
  });

  it("debug=false 시 report.json이 정상적으로 생성된다 (스키마 불변)", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: false,
    });

    expect(fs.existsSync(result.reportJsonPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8"));
    // report.json 스키마 핵심 필드가 있어야 한다
    expect(report).toHaveProperty("outcome");
    expect(report).toHaveProperty("sessionId");
    // debug 관련 필드가 report.json에 없어야 한다 (별도 파일로만)
    expect(report).not.toHaveProperty("debugDir");
    expect(report).not.toHaveProperty("debugArtifacts");
  });
});

// ── B-3: debug=on 아티팩트 기록 ──────────────────────────────────────

describe("runE2eTest — debug=true", () => {
  it("debug=true 시 sessionDir/debug/ 디렉토리가 생성된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
    });

    expect(fs.existsSync(path.join(result.sessionDir, "debug"))).toBe(true);
  });

  it("debug=true 시 manifest.json이 생성된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
    });

    const manifestPath = path.join(result.sessionDir, "debug", "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    // manifest 필드 확인
    expect(manifest).toHaveProperty("karaxVersion");
    expect(manifest).toHaveProperty("nodeVersion");
    expect(manifest).toHaveProperty("platform");
    expect(manifest).toHaveProperty("timestamp");
    // apiKey는 manifest에 없어야 한다
    expect(JSON.stringify(manifest)).not.toContain("apiKey");
    expect(JSON.stringify(manifest)).not.toContain("sk-");
  });

  it("debug=true + API 키 전달 시 manifest.json에 API 키 값이 없다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
      apiKey: "sk-ant-api03-test-secret-key-value",
    });

    const manifestPath = path.join(result.sessionDir, "debug", "manifest.json");
    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).not.toContain("sk-ant-api03-test-secret-key-value");
  });

  it("debug=true 시 report.json 스키마는 불변이다 (debug 필드 없음)", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
    });

    const report = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8"));
    expect(report).not.toHaveProperty("debugDir");
    expect(report).not.toHaveProperty("debugArtifacts");
  });
});

// ── B-3: teardown debug 기록 ─────────────────────────────────────────

describe("runE2eTest — teardown 동작", () => {
  it("debug=false + shutdown 실패 시 에러를 삼킨다 (기존 침묵 유지)", async () => {
    const mockManager = makeMockDeviceManager();
    mockManager.shutdown.mockRejectedValue(new Error("shutdown failed"));
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    // 예외 없이 완료되어야 한다
    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: false,
      keepBooted: false,
    });

    expect(result.outcome).toBe("pass");
    // teardown.log 없어야 한다
    expect(fs.existsSync(path.join(result.sessionDir, "debug", "teardown.log"))).toBe(false);
  });

  it("debug=true + shutdown 실패 시 teardown.log가 생성된다", async () => {
    const mockManager = makeMockDeviceManager();
    mockManager.shutdown.mockRejectedValue(new Error("shutdown connection lost"));
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
      keepBooted: false,
    });

    expect(result.outcome).toBe("pass");
    const teardownLog = path.join(result.sessionDir, "debug", "teardown.log");
    expect(fs.existsSync(teardownLog)).toBe(true);
    const content = fs.readFileSync(teardownLog, "utf-8");
    expect(content).toContain("shutdown");
    // stderr 스파이로 [karax/debug] 출력이 가로채졌는지 검증
    const stderrCalls = (stderrSpy.mock.calls as unknown[][]).map((args) => String(args[0]));
    expect(stderrCalls.some((s) => s.includes("[karax/debug]") && s.includes("teardown"))).toBe(true);
  });
});

// ── B-3: makeErrorResult — debug error.json ─────────────────────────

describe("runE2eTest — error 경로 debug 아티팩트", () => {
  it("debug=false + 빌드 실패 시 error.json이 생성되지 않는다", async () => {
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
      debug: false,
    });

    expect(result.outcome).toBe("error");
    expect(fs.existsSync(path.join(result.sessionDir, "debug"))).toBe(false);
  });

  it("debug=true + 빌드 실패 시 error.json이 생성된다 (report.json 스키마 불변)", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue({
      framework: "flutter",
      platform: "android" as const,
      build: vi.fn().mockRejectedValue(new E2eError("BUILD_FAILED", "빌드 실패: 환경 오류")),
    } as ReturnType<typeof selectBuilder>);

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
    });

    expect(result.outcome).toBe("error");
    // error.json 생성
    const errorJsonPath = path.join(result.sessionDir, "debug", "error.json");
    expect(fs.existsSync(errorJsonPath)).toBe(true);
    const errorData = JSON.parse(fs.readFileSync(errorJsonPath, "utf-8"));
    expect(errorData).toHaveProperty("code");
    expect(errorData.code).toBe("BUILD_FAILED");
    // report.json 스키마 불변
    const report = JSON.parse(fs.readFileSync(result.reportJsonPath, "utf-8"));
    expect(report).not.toHaveProperty("debugDir");
  });

  it("debug=true + E2eError details에 시크릿이 있으면 error.json에서 redact된다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue({
      framework: "flutter",
      platform: "android" as const,
      build: vi.fn().mockRejectedValue(
        new E2eError("BUILD_FAILED", "빌드 실패", "sk-ant-api03-realkey123 leaked in stderr")
      ),
    } as ReturnType<typeof selectBuilder>);

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
    });

    const errorJsonPath = path.join(result.sessionDir, "debug", "error.json");
    expect(fs.existsSync(errorJsonPath)).toBe(true);
    const content = fs.readFileSync(errorJsonPath, "utf-8");
    expect(content).not.toContain("sk-ant-api03-realkey123");
    expect(content).toContain("[REDACTED]");
  });
});

// ── B-3: manifest.json 경로 노출 축소 ─────────────────────────────────────

describe("runE2eTest — manifest.json 경로 상대화", () => {
  it("debug=true 시 manifest options.projectPath가 문자열이다", async () => {
    mockCreateDeviceManager.mockResolvedValue(makeMockDeviceManager() as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);
    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
    });

    const manifestPath = path.join(result.sessionDir, "debug", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      options: { projectPath: string };
    };
    // projectPath는 문자열이어야 한다 (상대 또는 절대 모두 허용 — tmpDir이 cwd 밖이면 절대 유지)
    expect(typeof manifest.options.projectPath).toBe("string");
    expect(manifest.options.projectPath.length).toBeGreaterThan(0);
  });
});

// ── teardown.log append (Phase C 잔여 결함 수정) ─────────────────────────────

describe("teardown.log — append 방식 (덮어쓰기 금지)", () => {
  it("recorder.stop 실패 + shutdown 실패가 모두 teardown.log에 누적된다", async () => {
    // recorder.stop과 shutdown이 둘 다 실패하면 두 항목이 모두 teardown.log에 있어야 한다.
    // 현재 write()가 overwrite라면 첫 항목이 유실된다 (Phase C 결함 수정 대상).
    const mockManager = makeMockDeviceManager();
    mockManager.shutdown.mockRejectedValue(new Error("shutdown conn lost"));
    mockCreateDeviceManager.mockResolvedValue(mockManager as ReturnType<typeof createDeviceManager>);
    mockSelectBuilder.mockReturnValue(makeMockBuilder() as ReturnType<typeof selectBuilder>);

    // recorder.stop 실패를 시뮬레이션하기 위해 recorder mock 주입
    // runE2eTest가 내부적으로 recorder를 생성하므로 recorder 관련 mock이 필요하다.
    // recordVideo=true로 설정하면 recorder가 활성화되는데, 여기서는 stop 실패를
    // 유도하기 위해 startAndroidRecording을 mock한다.
    const mockRecorder = {
      stop: vi.fn().mockRejectedValue(new Error("recorder stop failed")),
    };

    // startAndroidRecording mock
    const recorderMod = await import("../recorder.js");
    vi.spyOn(recorderMod, "startAndroidRecording").mockResolvedValue(
      mockRecorder as unknown as ReturnType<typeof recorderMod.startAndroidRecording>
    );

    mockRunAgent.mockResolvedValue({ outcome: "pass", summary: "통과", steps: [] });

    const result = await runE2eTest({
      projectPath: tmpDir,
      platform: "android",
      outDir: tmpDir,
      debug: true,
      keepBooted: false,
      recordVideo: true,
    });

    expect(result.outcome).toBe("pass");
    const teardownLog = path.join(result.sessionDir, "debug", "teardown.log");
    expect(fs.existsSync(teardownLog)).toBe(true);
    const content = fs.readFileSync(teardownLog, "utf-8");
    // 두 오류가 모두 누적되어야 한다 (append 방식이면 통과)
    expect(content).toContain("recorder.stop");
    expect(content).toContain("shutdown");
  });
});
