/**
 * device/ios.ts — iOS 디바이스 매니저 (xcrun simctl)
 *
 * selectSimulator 파싱 로직은 compile-ios/src/harness/generator.ts에서
 * 개작 (import 금지 — 레이어링 위반 방지, 기존 관례 따름).
 */

import fs from "fs";
import path from "path";
import { execa } from "execa";
import { E2eError } from "../types.js";
import { parseSimctlDevices, selectBestSimulator } from "./parse.js";
import type { DeviceManager, DeviceInfo } from "./types.js";

const SIMCTL_TIMEOUT = 60_000;
const BOOT_TIMEOUT_DEFAULT = 120_000;
const BOOT_POLL_INTERVAL_DEFAULT = 2_000;

// ── 옵션 타입 ────────────────────────────────────────────────────────────

export interface IosDeviceManagerOptions {
  /** 시뮬레이터 부팅 폴링 타임아웃 (ms). 기본값: 120000 */
  bootTimeoutMs?: number;
  /** 부팅 폴링 간격 (ms). 기본값: 2000 */
  pollIntervalMs?: number;
}

export function createIosDeviceManager(options: IosDeviceManagerOptions = {}): DeviceManager {
  const bootTimeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_DEFAULT;
  const pollIntervalMs = options.pollIntervalMs ?? BOOT_POLL_INTERVAL_DEFAULT;
  return {
    platform: "ios",

    async list(): Promise<DeviceInfo[]> {
      const result = await execa("xcrun", ["simctl", "list", "devices", "available"], {
        timeout: SIMCTL_TIMEOUT,
      });
      const entries = parseSimctlDevices(String(result.stdout));
      return entries.map((e) => ({
        id: e.udid,
        name: e.name,
        platform: "ios",
        isEmulator: true,
        isBooted: e.state === "Booted",
      }));
    },

    async ensureBooted(preferredId?: string): Promise<DeviceInfo> {
      // 이미 Booted인 시뮬레이터 재사용
      const all = await this.list();
      const booted = all.filter((d) => d.isBooted);

      if (booted.length > 0) {
        if (preferredId) {
          const preferred = booted.find((d) => d.id === preferredId);
          if (preferred) return preferred;
        }
        return booted[0]!;
      }

      // 최적 시뮬레이터 선택
      const simctlResult = await execa("xcrun", ["simctl", "list", "devices", "available"], {
        timeout: SIMCTL_TIMEOUT,
      });
      const best = selectBestSimulator(String(simctlResult.stdout));

      if (!best) {
        throw new E2eError(
          "NO_DEVICE_AVAILABLE",
          "사용 가능한 iOS 시뮬레이터가 없습니다. Xcode Simulator를 설치해주세요."
        );
      }

      const targetUdid = preferredId ?? best.udid;

      // boot 시작
      await execa("xcrun", ["simctl", "boot", targetUdid], {
        timeout: SIMCTL_TIMEOUT,
      }).catch(() => {
        // 이미 부팅 중이면 오류 무시
      });

      // bootstatus -b 로 부팅 완료 대기
      try {
        await execa("xcrun", ["simctl", "bootstatus", targetUdid, "-b"], {
          timeout: bootTimeoutMs,
        });
      } catch {
        // bootstatus 실패 시 폴링으로 fallback
        const deadline = Date.now() + bootTimeoutMs;
        let bootConfirmed = false;

        while (Date.now() < deadline) {
          await sleep(pollIntervalMs);
          const listResult = await execa("xcrun", ["simctl", "list", "devices", "available"], {
            timeout: SIMCTL_TIMEOUT,
          }).catch(() => null);
          if (!listResult) continue;

          const entries = parseSimctlDevices(String(listResult.stdout));
          const booted = entries.find((e) => e.udid === targetUdid && e.state === "Booted");
          if (booted) {
            bootConfirmed = true;
            break;
          }
        }

        if (!bootConfirmed) {
          throw new E2eError(
            "EMULATOR_BOOT_TIMEOUT",
            `iOS 시뮬레이터 부팅 타임아웃 (${bootTimeoutMs / 1000}s)`
          );
        }
      }

      return {
        id: targetUdid,
        name: best.name,
        platform: "ios",
        isEmulator: true,
        isBooted: true,
      };
    },

    async install(deviceId: string, artifactPath: string): Promise<void> {
      const result = await execa(
        "xcrun",
        ["simctl", "install", deviceId, artifactPath],
        { timeout: SIMCTL_TIMEOUT }
      );
      if (result.exitCode !== 0) {
        throw new E2eError(
          "INSTALL_FAILED",
          `.app 설치 실패: ${result.stderr}`,
          String(result.stderr)
        );
      }
    },

    async launch(deviceId: string, appId: string): Promise<void> {
      const result = await execa(
        "xcrun",
        ["simctl", "launch", deviceId, appId],
        { timeout: SIMCTL_TIMEOUT }
      );
      if (result.exitCode !== 0) {
        throw new E2eError(
          "LAUNCH_FAILED",
          `앱 실행 실패: ${result.stderr}`,
          String(result.stderr)
        );
      }
    },

    async screenshot(deviceId: string, destPngPath: string): Promise<void> {
      fs.mkdirSync(path.dirname(destPngPath), { recursive: true });
      const result = await execa(
        "xcrun",
        ["simctl", "io", deviceId, "screenshot", destPngPath],
        { timeout: SIMCTL_TIMEOUT }
      );
      if (result.exitCode !== 0) {
        throw new E2eError(
          "LAUNCH_FAILED",
          `스크린샷 실패: ${result.stderr}`,
          String(result.stderr)
        );
      }
    },

    async shutdown(deviceId: string): Promise<void> {
      await execa("xcrun", ["simctl", "shutdown", deviceId], {
        timeout: SIMCTL_TIMEOUT,
      }).catch(() => {
        // 종료 실패 무시
      });
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
