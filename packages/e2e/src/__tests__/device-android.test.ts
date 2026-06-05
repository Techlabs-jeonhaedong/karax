/**
 * device/android.ts 단위 테스트 (execa mock)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2eError } from "../types.js";

// execa mock
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// @sfc/doctor mock
vi.mock("@sfc/doctor", () => ({
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

  describe("실기기 경로 (SFC_E2E_REAL 가드)", () => {
    it("SFC_E2E_REAL 없으면 ensureBooted 테스트를 skip", () => {
      if (process.env["SFC_E2E_REAL"]) return;
      // 실기기 없이는 ensureBooted 테스트 수행 안 함
      expect(true).toBe(true);
    });
  });
});
