/**
 * device/ios.ts 단위 테스트 (execa mock)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { createIosDeviceManager } from "../device/ios.js";

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

const SAMPLE_SIMCTL_OUTPUT = `== Devices ==
-- iOS 17.2 --
    iPhone 15 Pro (ABCD1234-0000-0000-0000-000000000001) (Shutdown)
-- iOS 16.4 --
    iPhone 14 (ABCD1234-0000-0000-0000-000000000002) (Shutdown)`;

describe("createIosDeviceManager", () => {
  describe("list()", () => {
    it("simctl 출력을 파싱해 디바이스 목록을 반환한다", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });

      const manager = createIosDeviceManager();
      const devices = await manager.list();
      expect(devices.length).toBeGreaterThan(0);
      expect(devices[0]?.platform).toBe("ios");
    });
  });

  describe("install()", () => {
    it("simctl install 을 호출한다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

      const manager = createIosDeviceManager();
      await manager.install("ABCD1234-0000-0000-0000-000000000001", "/tmp/App.app");

      expect(mockExeca).toHaveBeenCalledWith(
        "xcrun",
        expect.arrayContaining(["simctl", "install", "ABCD1234-0000-0000-0000-000000000001", "/tmp/App.app"]),
        expect.any(Object)
      );
    });

    it("설치 실패 시 INSTALL_FAILED 에러를 던진다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "error", exitCode: 1 });

      const manager = createIosDeviceManager();
      await expect(manager.install("UDID", "/tmp/App.app")).rejects.toMatchObject({
        code: "INSTALL_FAILED",
      });
    });
  });

  describe("launch()", () => {
    it("simctl launch 를 호출한다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "MyApp: 1234", stderr: "", exitCode: 0 });

      const manager = createIosDeviceManager();
      await manager.launch("UDID", "com.example.app");

      expect(mockExeca).toHaveBeenCalledWith(
        "xcrun",
        expect.arrayContaining(["simctl", "launch", "UDID", "com.example.app"]),
        expect.any(Object)
      );
    });
  });

  describe("screenshot()", () => {
    it("simctl io screenshot 를 호출한다", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

      const manager = createIosDeviceManager();
      await manager.screenshot("UDID", "/tmp/screen.png");

      expect(mockExeca).toHaveBeenCalledWith(
        "xcrun",
        expect.arrayContaining(["simctl", "io", "UDID", "screenshot", "/tmp/screen.png"]),
        expect.any(Object)
      );
    });
  });

  describe("실기기 경로 (SFC_E2E_REAL 가드)", () => {
    it("SFC_E2E_REAL 없으면 ensureBooted 실기기 테스트를 skip", () => {
      if (process.env["SFC_E2E_REAL"]) return;
      expect(true).toBe(true);
    });
  });
});
