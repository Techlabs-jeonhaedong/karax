/**
 * recorder.ts 단위 테스트 (execa mock)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

// execa mock
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// fs mock
vi.mock("fs");
const mockFs = vi.mocked(fs);

// crypto — 랜덤 suffix에 쓰임, 실제 crypto는 노드 내장이므로 실사용
// 결정론 테스트를 위해 randomBytes만 mock
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue(Buffer.from("cafebabe", "hex")),
  };
});

import { execa } from "execa";
import { startAndroidRecording, startIosRecording } from "../recorder.js";

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.mkdirSync.mockReturnValue(undefined);
  mockFs.existsSync.mockReturnValue(false);
});

// ── Android ────────────────────────────────────────────────────────

describe("startAndroidRecording", () => {
  it("adb shell screenrecord --time-limit 180 으로 세그먼트를 시작한다", async () => {
    // execa: 첫 번째는 세그먼트 프로세스 (kill로 종료되는 detached), 이후 pull/rm
    const mockProc = {
      pid: 12345,
      kill: vi.fn(),
      killed: false,
      exitCode: null,
      stdout: "",
      stderr: "",
    } as unknown as ReturnType<typeof execa>;

    let resolveProc: () => void;
    const procPromise = new Promise<void>((resolve) => { resolveProc = resolve; });
    Object.assign(mockProc, { then: procPromise.then.bind(procPromise) });

    // 세그먼트 시작: detached 프로세스 반환 (종료 안 됨)
    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);

    const recorder = await startAndroidRecording("emulator-5554", "/tmp/videos");

    // screenrecord 인자 확인
    expect(mockExeca).toHaveBeenCalledWith(
      expect.stringContaining("adb"),
      expect.arrayContaining([
        "-s", "emulator-5554",
        "shell", "screenrecord",
        "--time-limit", "180",
      ]),
      expect.objectContaining({ detached: true })
    );

    expect(recorder).toBeDefined();
    expect(typeof recorder.stop).toBe("function");
  });

  it("stop()이 SIGINT를 보내고 adb pull로 파일을 가져온다", async () => {
    // Promise-like mock proc (then/catch 지원)
    const procPromise = new Promise<void>(() => { /* 영원히 pending */ });
    const mockProc = Object.assign(procPromise, {
      pid: 12345,
      kill: vi.fn(),
      killed: false,
    }) as unknown as ReturnType<typeof execa>;

    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);

    // pull 성공
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 } as unknown as ReturnType<typeof execa>);
    // rm best-effort
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 } as unknown as ReturnType<typeof execa>);

    const recorder = await startAndroidRecording("emulator-5554", "/tmp/videos");
    const files = await recorder.stop();

    // SIGINT 전송
    expect(mockProc.kill).toHaveBeenCalledWith("SIGINT");

    // adb pull 호출
    expect(mockExeca).toHaveBeenCalledWith(
      expect.stringContaining("adb"),
      expect.arrayContaining(["-s", "emulator-5554", "pull"]),
      expect.any(Object)
    );

    // 결과 파일 목록 반환
    expect(Array.isArray(files)).toBe(true);
  });

  it("stop() 실패(pull 오류)도 비차단 — 빈 배열 반환", async () => {
    const procPromise = new Promise<void>(() => { /* pending */ });
    const mockProc = Object.assign(procPromise, {
      pid: 12345,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof execa>;

    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);
    // pull 실패
    mockExeca.mockRejectedValueOnce(new Error("adb pull failed"));

    const recorder = await startAndroidRecording("emulator-5554", "/tmp/videos");
    const files = await recorder.stop();

    // 실패해도 throw 없이 빈/부분 배열 반환
    expect(Array.isArray(files)).toBe(true);
  });

  it("디바이스 경로는 고정 prefix + 랜덤 suffix로 구성된다", async () => {
    const procPromise = new Promise<void>(() => {});
    const mockProc = Object.assign(procPromise, { pid: 1, kill: vi.fn() }) as unknown as ReturnType<typeof execa>;
    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);

    await startAndroidRecording("emulator-5554", "/tmp/videos");

    const call = mockExeca.mock.calls[0]!;
    const args = call[1] as string[];
    // 인자 구조: ["-s", deviceId, "shell", "screenrecord", "--time-limit", "180", "/sdcard/karax_rec_..."]
    // 마지막 인자가 디바이스 경로
    const recPath = args[args.length - 1]!;
    expect(recPath).toMatch(/\/sdcard\/karax_rec_/);
  });
});

// ── iOS ────────────────────────────────────────────────────────────

describe("startIosRecording", () => {
  it("xcrun simctl io recordVideo --codec h264 을 호출한다", async () => {
    const mockProc = {
      pid: 99,
      kill: vi.fn(),
    } as unknown as ReturnType<typeof execa>;

    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);

    const recorder = await startIosRecording("UDID-1234", "/tmp/videos");

    expect(mockExeca).toHaveBeenCalledWith(
      "xcrun",
      expect.arrayContaining([
        "simctl", "io", "UDID-1234", "recordVideo", "--codec", "h264",
      ]),
      expect.objectContaining({ detached: true })
    );

    expect(recorder).toBeDefined();
  });

  it("stop()이 SIGINT를 보내고 종료를 대기한다", async () => {
    const procPromise = new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const mockProc = Object.assign(procPromise, {
      pid: 99,
      kill: vi.fn(),
    }) as unknown as ReturnType<typeof execa>;

    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);

    const recorder = await startIosRecording("UDID-1234", "/tmp/videos");
    const files = await recorder.stop();

    expect(mockProc.kill).toHaveBeenCalledWith("SIGINT");
    expect(Array.isArray(files)).toBe(true);
  });

  it("stop() 실패해도 비차단 — 빈 배열 반환", async () => {
    const procPromise = new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const mockProc = Object.assign(procPromise, {
      pid: 99,
      kill: vi.fn().mockImplementation(() => { throw new Error("no proc"); }),
    }) as unknown as ReturnType<typeof execa>;

    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);

    const recorder = await startIosRecording("UDID-1234", "/tmp/videos");
    const files = await recorder.stop();

    expect(Array.isArray(files)).toBe(true);
  });

  it("output 파일 경로는 videosDir 아래에 생성된다", async () => {
    const procPromise = new Promise<void>(() => {});
    const mockProc = Object.assign(procPromise, { pid: 99, kill: vi.fn() }) as unknown as ReturnType<typeof execa>;
    mockExeca.mockReturnValueOnce(mockProc as unknown as ReturnType<typeof execa>);

    await startIosRecording("UDID-1234", "/tmp/my-videos");

    const call = mockExeca.mock.calls[0]!;
    const args = call[1] as string[];
    const outPath = args[args.length - 1]!;
    expect(outPath).toMatch(/\/tmp\/my-videos/);
    expect(outPath).toMatch(/\.mov$/);
  });
});
