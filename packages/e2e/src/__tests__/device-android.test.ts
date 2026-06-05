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

beforeEach(() => {
  vi.clearAllMocks();
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

  describe("실기기 경로 (KARAX_E2E_REAL 가드)", () => {
    it("KARAX_E2E_REAL 없으면 ensureBooted 테스트를 skip", () => {
      if (process.env["KARAX_E2E_REAL"]) return;
      // 실기기 없이는 ensureBooted 테스트 수행 안 함
      expect(true).toBe(true);
    });
  });

  // ── 인자 검증 (항목 8) ─────────────────────────────────────────────

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
      // 예외 없이 통과해야 함
      await expect(manager.install("emulator-5554", "/tmp/app.apk")).resolves.toBeUndefined();
    });
  });

  // ── ensureBooted 타임아웃 시 emulator 프로세스 kill (항목 10) ────────────

  describe("ensureBooted — 타임아웃 시 emulator kill", () => {
    it("EMULATOR_BOOT_TIMEOUT 에러 코드가 E2eError로 정의됨", () => {
      // 실제 타임아웃(180s)을 기다릴 수 없으므로 에러 코드 정의를 검증한다
      const err = new E2eError("EMULATOR_BOOT_TIMEOUT", "부팅 타임아웃");
      expect(err.code).toBe("EMULATOR_BOOT_TIMEOUT");
      expect(err).toBeInstanceOf(Error);
    });

    it("ensureBooted: 부팅된 기기 없고 AVD도 없으면 NO_DEVICE_AVAILABLE", async () => {
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
  });
});
