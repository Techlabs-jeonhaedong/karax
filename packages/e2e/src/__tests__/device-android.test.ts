/**
 * device/android.ts 단위 테스트 (execa mock)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2eError } from "../types.js";

// execa mock
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// @karax/doctor mock
vi.mock("@karax/doctor", () => ({
  detectAndroidSdkPath: vi.fn().mockResolvedValue("/sdk"),
}));

import { execa } from "execa";
import { createAndroidDeviceManager } from "../device/android.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

// process.kill mock (kill 호출 검증)
const mockProcessKill = vi.spyOn(process, "kill").mockImplementation(() => true);

beforeEach(() => {
  vi.clearAllMocks();
  mockProcessKill.mockClear();
});

describe("createAndroidDeviceManager", () => {
  describe("list()", () => {
    it("adb devices 출력을 파싱해 device 상태만 반환한다", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "List of devices attached\nemulator-5554\tdevice\n",
        stderr: "",
        exitCode: 0,
      });

      const manager = createAndroidDeviceManager("/sdk");
      const devices = await manager.list();
      expect(devices).toHaveLength(1);
      expect(devices[0]?.id).toBe("emulator-5554");
    });

    it("디바이스 없으면 빈 배열 반환", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "List of devices attached\n",
        stderr: "",
        exitCode: 0,
      });

      const manager = createAndroidDeviceManager("/sdk");
      const devices = await manager.list();
      expect(devices).toHaveLength(0);
    });
  });

  describe("install()", () => {
    it("adb install -r -t 를 올바른 인수로 호출한다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "Success", stderr: "", exitCode: 0 });

      const manager = createAndroidDeviceManager("/sdk");
      await manager.install("emulator-5554", "/tmp/app.apk");

      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining("adb"),
        expect.arrayContaining(["-s", "emulator-5554", "install", "-r", "-t", "/tmp/app.apk"]),
        expect.any(Object)
      );
    });

    it("adb 실패 시 INSTALL_FAILED 에러를 던진다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "Failed", exitCode: 1 });

      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.install("emulator-5554", "/tmp/app.apk")).rejects.toMatchObject({
        code: "INSTALL_FAILED",
      });
    });
  });

  describe("launch()", () => {
    it("adb shell monkey 를 호출한다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "Events injected: 1", stderr: "", exitCode: 0 });

      const manager = createAndroidDeviceManager("/sdk");
      await manager.launch("emulator-5554", "com.example.app");

      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining("adb"),
        expect.arrayContaining(["-s", "emulator-5554", "shell", "monkey"]),
        expect.any(Object)
      );
    });

    it("launch 실패 시 LAUNCH_FAILED 에러를 던진다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "error", exitCode: 1 });

      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.launch("emulator-5554", "com.example.app")).rejects.toMatchObject({
        code: "LAUNCH_FAILED",
      });
    });
  });

  describe("screenshot()", () => {
    it("adb exec-out screencap -p 를 호출한다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: Buffer.alloc(0), stderr: "", exitCode: 0 });

      const manager = createAndroidDeviceManager("/sdk");
      await manager.screenshot("emulator-5554", "/tmp/screen.png");

      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining("adb"),
        expect.arrayContaining(["-s", "emulator-5554", "exec-out", "screencap", "-p"]),
        expect.any(Object)
      );
    });
  });

  // ── 인자 검증 ─────────────────────────────────────────────────────────────

  describe("인자 검증", () => {
    it("'-e' 로 시작하는 deviceId를 거부한다 (INVALID_ARGUMENT)", async () => {
      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.install("-e", "/tmp/app.apk")).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_ARGUMENT|INSTALL_FAILED/),
      });
    });

    it("'-p' 로 시작하는 appId를 거부한다 (INVALID_ARGUMENT)", async () => {
      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.launch("emulator-5554", "-p bad.app")).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_ARGUMENT|LAUNCH_FAILED/),
      });
    });

    it("숫자로 시작하는 appId를 거부한다 (INVALID_ARGUMENT)", async () => {
      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.launch("emulator-5554", "1bad.app")).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_ARGUMENT|LAUNCH_FAILED/),
      });
    });

    it("셸 메타문자 포함 deviceId를 거부한다 (INVALID_ARGUMENT)", async () => {
      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.install("emulator-5554; rm -rf /", "/tmp/app.apk")).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_ARGUMENT|INSTALL_FAILED/),
      });
    });

    it("상대 경로 artifactPath를 거부한다 (INVALID_ARGUMENT)", async () => {
      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.install("emulator-5554", "relative/path/app.apk")).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_ARGUMENT|INSTALL_FAILED/),
      });
    });

    it("-로 시작하는 artifactPath를 거부한다 (INVALID_ARGUMENT)", async () => {
      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.install("emulator-5554", "-malicious.apk")).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_ARGUMENT|INSTALL_FAILED/),
      });
    });

    it("유효한 deviceId/appId/artifactPath는 통과한다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "Success", stderr: "", exitCode: 0 });
      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.install("emulator-5554", "/tmp/app.apk")).resolves.toBeUndefined();
    });
  });

  // ── ensureBooted — 폴링 타임아웃 경로 (항목 D) ────────────────────────────

  describe("ensureBooted — 폴링 타임아웃 경로", () => {
    it("부팅된 기기 없고 AVD도 없으면 NO_DEVICE_AVAILABLE", async () => {
      // list → 빈 배열
      mockExeca.mockResolvedValueOnce({
        stdout: "List of devices attached\n",
        stderr: "",
        exitCode: 0,
      });
      // listAvds → 빈 배열
      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const manager = createAndroidDeviceManager("/sdk");
      await expect(manager.ensureBooted()).rejects.toMatchObject({
        code: "NO_DEVICE_AVAILABLE",
      });
    });

    it("폴링 deadline 만료 시 EMULATOR_BOOT_TIMEOUT을 던지고 emulator process.kill을 호출한다", async () => {
      // list → 빈 배열 (부팅된 기기 없음)
      mockExeca.mockResolvedValueOnce({
        stdout: "List of devices attached\n",
        stderr: "",
        exitCode: 0,
      });
      // listAvds → AVD 있음
      mockExeca.mockResolvedValueOnce({
        stdout: "Pixel_8_API_34\n",
        stderr: "",
        exitCode: 0,
      });
      // emulator 시작 (detached) — pid를 돌려줄 mock
      const mockEmulatorProc = {
        pid: 99999,
        unref: vi.fn(),
      };
      mockExeca.mockReturnValueOnce(mockEmulatorProc);

      // 폴링 중 adb devices → 항상 빈 응답 (부팅 미완료)
      // bootTimeoutMs=50ms, pollIntervalMs=0ms → 최대 수 회 폴링 후 deadline 만료
      mockExeca.mockResolvedValue({
        stdout: "List of devices attached\n",
        stderr: "",
        exitCode: 0,
      });

      const manager = createAndroidDeviceManager("/sdk", {
        bootTimeoutMs: 50,
        pollIntervalMs: 0,
      });

      await expect(manager.ensureBooted()).rejects.toMatchObject({
        code: "EMULATOR_BOOT_TIMEOUT",
      });

      // best-effort process.kill 호출 확인
      expect(mockProcessKill).toHaveBeenCalledWith(99999);
    });

    it("폴링 도중 sys.boot_completed=1 확인 시 정상 DeviceInfo 반환", async () => {
      // list → 빈 배열 (처음에 부팅된 기기 없음)
      mockExeca.mockResolvedValueOnce({
        stdout: "List of devices attached\n",
        stderr: "",
        exitCode: 0,
      });
      // listAvds → AVD 있음
      mockExeca.mockResolvedValueOnce({
        stdout: "Pixel_8_API_34\n",
        stderr: "",
        exitCode: 0,
      });
      // emulator 시작 (detached)
      const mockEmulatorProc = {
        pid: 12345,
        unref: vi.fn(),
      };
      mockExeca.mockReturnValueOnce(mockEmulatorProc);

      // 첫 번째 폴링 adb devices → 에뮬레이터 등장
      mockExeca.mockResolvedValueOnce({
        stdout: "List of devices attached\nemulator-5554\tdevice\n",
        stderr: "",
        exitCode: 0,
      });
      // getprop sys.boot_completed → 1
      mockExeca.mockResolvedValueOnce({
        stdout: "1",
        stderr: "",
        exitCode: 0,
      });

      const manager = createAndroidDeviceManager("/sdk", {
        bootTimeoutMs: 5000,
        pollIntervalMs: 0,
      });

      const device = await manager.ensureBooted();
      expect(device.id).toBe("emulator-5554");
      expect(device.isBooted).toBe(true);
      expect(device.platform).toBe("android");
      // 정상 완료 시 process.kill 미호출
      expect(mockProcessKill).not.toHaveBeenCalled();
    });

    it("이미 부팅된 기기가 있으면 에뮬레이터를 새로 시작하지 않는다", async () => {
      // list → 이미 부팅된 기기 있음
      mockExeca.mockResolvedValueOnce({
        stdout: "List of devices attached\nemulator-5554\tdevice\n",
        stderr: "",
        exitCode: 0,
      });

      const manager = createAndroidDeviceManager("/sdk", {
        bootTimeoutMs: 50,
        pollIntervalMs: 0,
      });

      const device = await manager.ensureBooted();
      expect(device.id).toBe("emulator-5554");
      // emulator 시작 mock 호출 없음 (execa 1회만 호출)
      expect(mockExeca).toHaveBeenCalledTimes(1);
    });
  });
});
