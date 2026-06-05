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

const SAMPLE_SIMCTL_BOOTED = `== Devices ==
-- iOS 17.2 --
    iPhone 15 Pro (ABCD1234-0000-0000-0000-000000000001) (Booted)`;

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

  // ── ensureBooted — 폴링 타임아웃 경로 (항목 D) ────────────────────────────

  describe("ensureBooted — 폴링 타임아웃 경로", () => {
    it("이미 Booted 시뮬레이터가 있으면 바로 반환한다", async () => {
      // list 호출 (이미 Booted)
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_BOOTED,
        stderr: "",
        exitCode: 0,
      });

      const manager = createIosDeviceManager();
      const device = await manager.ensureBooted();
      expect(device.id).toBe("ABCD1234-0000-0000-0000-000000000001");
      expect(device.isBooted).toBe(true);
      expect(mockExeca).toHaveBeenCalledTimes(1);
    });

    it("bootstatus 실패 → 폴링 fallback → Booted 관측 시 정상 반환", async () => {
      // list → Shutdown (부팅 안 된 상태)
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });
      // selectBestSimulator용 list 재호출
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });
      // simctl boot
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
      // bootstatus -b → 실패 (폴링 fallback 진입)
      mockExeca.mockRejectedValueOnce(new Error("bootstatus not supported"));
      // 폴링 중 simctl list → Booted 상태
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_BOOTED,
        stderr: "",
        exitCode: 0,
      });

      const manager = createIosDeviceManager({
        bootTimeoutMs: 5000,
        pollIntervalMs: 0,
      });

      const device = await manager.ensureBooted();
      expect(device.id).toBe("ABCD1234-0000-0000-0000-000000000001");
      expect(device.isBooted).toBe(true);
    });

    it("bootstatus 실패 → 폴링 fallback → deadline 만료 → EMULATOR_BOOT_TIMEOUT 던짐", async () => {
      // list → Shutdown
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });
      // selectBestSimulator용 list
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });
      // simctl boot
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
      // bootstatus -b → 실패
      mockExeca.mockRejectedValueOnce(new Error("bootstatus not supported"));
      // 폴링 중 simctl list → 계속 Shutdown (Booted 안 됨)
      mockExeca.mockResolvedValue({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });

      const manager = createIosDeviceManager({
        bootTimeoutMs: 50,
        pollIntervalMs: 0,
      });

      await expect(manager.ensureBooted()).rejects.toMatchObject({
        code: "EMULATOR_BOOT_TIMEOUT",
      });
    });

    it("bootstatus 성공 시 폴링 없이 정상 반환한다", async () => {
      // list → Shutdown
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });
      // selectBestSimulator용 list
      mockExeca.mockResolvedValueOnce({
        stdout: SAMPLE_SIMCTL_OUTPUT,
        stderr: "",
        exitCode: 0,
      });
      // simctl boot
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
      // bootstatus -b → 성공 (폴링 불필요)
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

      const manager = createIosDeviceManager({
        bootTimeoutMs: 5000,
        pollIntervalMs: 0,
      });

      const device = await manager.ensureBooted();
      expect(device.isBooted).toBe(true);
    });

    it("ensureBooted — preferredId에 셸 메타문자 포함 시 INVALID_ARGUMENT", async () => {
      // validateDeviceId가 list() 호출 전에 throw하므로 execa mock 불필요
      const manager = createIosDeviceManager();
      await expect(manager.ensureBooted("ABCD1234; rm -rf /")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    it("ensureBooted — preferredId에 공백 포함 시 INVALID_ARGUMENT", async () => {
      const manager = createIosDeviceManager();
      await expect(manager.ensureBooted("ABCD 1234")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    it("install — deviceId에 세미콜론 포함 시 INVALID_ARGUMENT", async () => {
      const manager = createIosDeviceManager();
      await expect(manager.install("UDID;evil", "/tmp/App.app")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    it("launch — deviceId에 백슬래시 포함 시 INVALID_ARGUMENT", async () => {
      const manager = createIosDeviceManager();
      await expect(manager.launch("UDID\\evil", "com.example.app")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    it("사용 가능한 시뮬레이터 없으면 NO_DEVICE_AVAILABLE를 던진다", async () => {
      // list → 빈 결과
      mockExeca.mockResolvedValueOnce({ stdout: "== Devices ==\n", stderr: "", exitCode: 0 });
      // selectBestSimulator용 list → 빈 결과
      mockExeca.mockResolvedValueOnce({ stdout: "== Devices ==\n", stderr: "", exitCode: 0 });

      const manager = createIosDeviceManager();
      await expect(manager.ensureBooted()).rejects.toMatchObject({
        code: "NO_DEVICE_AVAILABLE",
      });
    });
  });
});
