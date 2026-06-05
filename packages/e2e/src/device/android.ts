/**
 * device/android.ts — Android 디바이스 매니저 (adb + emulator)
 */

import path from "path";
import fs from "fs";
import { execa } from "execa";
import { detectAndroidSdkPath } from "@karax/doctor";
import { E2eError } from "../types.js";
import { parseAdbDevices, parseEmulatorListAvds } from "./parse.js";
import type { DeviceManager, DeviceInfo } from "./types.js";

const ADB_TIMEOUT = 60_000;
const EMULATOR_BOOT_TIMEOUT_DEFAULT = 180_000;
const EMULATOR_POLL_INTERVAL_DEFAULT = 3_000;

// ── 옵션 타입 ────────────────────────────────────────────────────────────

export interface AndroidDeviceManagerOptions {
  /** 에뮬레이터 부팅 폴링 타임아웃 (ms). 기본값: 180000 */
  bootTimeoutMs?: number;
  /** 부팅 폴링 간격 (ms). 기본값: 3000 */
  pollIntervalMs?: number;
}

// ── 인자 검증 ────────────────────────────────────────────────────────────

/** deviceId 유효성: 영숫자, '_', ':', '.', '-' 허용. '-'로 시작 금지. */
const DEVICE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_:.\-]*$/;
/** appId 유효성: 영문자 시작, 영숫자·'_'·'.' 허용. */
const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;

function validateDeviceId(deviceId: string): void {
  if (!DEVICE_ID_RE.test(deviceId)) {
    throw new E2eError(
      "INVALID_ARGUMENT",
      `유효하지 않은 deviceId: "${deviceId}". 영숫자·'_'·':'·'.'·'-'만 허용, '-'로 시작 불가.`
    );
  }
}

function validateAppId(appId: string): void {
  if (!APP_ID_RE.test(appId)) {
    throw new E2eError(
      "INVALID_ARGUMENT",
      `유효하지 않은 appId: "${appId}". 영문자 시작, 영숫자·'_'·'.'만 허용.`
    );
  }
}

function validateArtifactPath(artifactPath: string): void {
  if (!path.isAbsolute(artifactPath)) {
    throw new E2eError(
      "INVALID_ARGUMENT",
      `artifactPath는 절대경로여야 합니다: "${artifactPath}"`
    );
  }
  if (path.basename(artifactPath).startsWith("-")) {
    throw new E2eError(
      "INVALID_ARGUMENT",
      `artifactPath 파일명이 '-'로 시작할 수 없습니다: "${artifactPath}"`
    );
  }
}

export function createAndroidDeviceManager(
  sdkPath: string,
  options: AndroidDeviceManagerOptions = {}
): DeviceManager & { listAvds(): Promise<string[]> } {
  const bootTimeoutMs = options.bootTimeoutMs ?? EMULATOR_BOOT_TIMEOUT_DEFAULT;
  const pollIntervalMs = options.pollIntervalMs ?? EMULATOR_POLL_INTERVAL_DEFAULT;

  const adbBin = path.join(sdkPath, "platform-tools", "adb");
  const emulatorBin = path.join(sdkPath, "emulator", "emulator");

  function adbArgs(deviceId: string, ...args: string[]): [string, string[], object] {
    return [adbBin, ["-s", deviceId, ...args], { timeout: ADB_TIMEOUT, env: buildEnv(sdkPath) }];
  }

  return {
    platform: "android",

    async list(): Promise<DeviceInfo[]> {
      const result = await execa(adbBin, ["devices"], {
        timeout: ADB_TIMEOUT,
        env: buildEnv(sdkPath),
      });
      const entries = parseAdbDevices(String(result.stdout)).filter(
        (e) => e.state === "device"
      );
      return entries.map((e) => ({
        id: e.id,
        name: e.id,
        platform: "android",
        isEmulator: e.isEmulator,
        isBooted: true,
      }));
    },

    async listAvds(): Promise<string[]> {
      try {
        const result = await execa(emulatorBin, ["-list-avds"], {
          timeout: ADB_TIMEOUT,
          env: buildEnv(sdkPath),
        });
        return parseEmulatorListAvds(String(result.stdout));
      } catch {
        return [];
      }
    },

    async ensureBooted(preferredId?: string): Promise<DeviceInfo> {
      // preferredId가 지정된 경우 먼저 검증 (adb -s / emulator -avd 인자로 흘러가므로)
      if (preferredId !== undefined) validateDeviceId(preferredId);
      // 이미 부팅된 디바이스 재사용
      const running = await this.list();
      if (running.length > 0) {
        if (preferredId) {
          const preferred = running.find((d) => d.id === preferredId);
          if (preferred) return preferred;
        }
        return running[0]!;
      }

      // AVD 목록 확인
      const avds = await this.listAvds();
      if (avds.length === 0) {
        throw new E2eError(
          "NO_DEVICE_AVAILABLE",
          "부팅된 Android 에뮬레이터도 없고 사용 가능한 AVD도 없습니다."
        );
      }

      const avdName = preferredId ?? avds[0]!;

      // 에뮬레이터 비동기 시작 (detached) — pid를 보관해 타임아웃 시 kill에 사용
      let emulatorPid: number | undefined;
      const emulatorProc = execa(emulatorBin, ["-avd", avdName, "-no-snapshot", "-no-audio"], {
        detached: true,
        stdio: "ignore",
        env: buildEnv(sdkPath),
      });
      emulatorPid = emulatorProc.pid;
      emulatorProc.unref();

      // 부팅 완료 폴링
      const deadline = Date.now() + bootTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        try {
          const devicesResult = await execa(adbBin, ["devices"], {
            timeout: ADB_TIMEOUT,
            env: buildEnv(sdkPath),
          });
          const entries = parseAdbDevices(String(devicesResult.stdout)).filter(
            (e) => e.state === "device"
          );
          if (entries.length > 0) {
            const deviceId = entries[0]!.id;
            // sys.boot_completed 확인
            const bootResult = await execa(
              adbBin,
              ["-s", deviceId, "shell", "getprop", "sys.boot_completed"],
              { timeout: ADB_TIMEOUT, env: buildEnv(sdkPath) }
            );
            if (String(bootResult.stdout).trim() === "1") {
              return { id: deviceId, name: deviceId, platform: "android", isEmulator: true, isBooted: true };
            }
          }
        } catch {
          // 폴링 중 일시적 오류 무시
        }
      }

      // 타임아웃 — 우리가 시작한 emulator 프로세스를 best-effort kill
      if (emulatorPid !== undefined) {
        try {
          process.kill(emulatorPid);
        } catch {
          // 이미 종료됐거나 kill 권한 없으면 무시
        }
      }

      throw new E2eError(
        "EMULATOR_BOOT_TIMEOUT",
        `Android 에뮬레이터 부팅 타임아웃 (${bootTimeoutMs / 1000}s)`
      );
    },

    async install(deviceId: string, artifactPath: string): Promise<void> {
      validateDeviceId(deviceId);
      validateArtifactPath(artifactPath);
      const result = await execa(...adbArgs(deviceId, "install", "-r", "-t", artifactPath));
      if (result.exitCode !== 0) {
        throw new E2eError(
          "INSTALL_FAILED",
          `APK 설치 실패: ${result.stderr}`,
          String(result.stderr)
        );
      }
    },

    async launch(deviceId: string, appId: string): Promise<void> {
      validateDeviceId(deviceId);
      validateAppId(appId);
      const result = await execa(
        ...adbArgs(deviceId, "shell", "monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1")
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
      validateDeviceId(deviceId);
      const result = await execa(
        ...adbArgs(deviceId, "exec-out", "screencap", "-p")
      );
      fs.mkdirSync(path.dirname(destPngPath), { recursive: true });
      // stdout이 binary PNG 데이터
      const data = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? ""));
      fs.writeFileSync(destPngPath, data);
    },

    async shutdown(deviceId: string): Promise<void> {
      validateDeviceId(deviceId);
      try {
        await execa(...adbArgs(deviceId, "emu", "kill"));
      } catch {
        // 종료 실패는 무시
      }
    },
  };
}

/**
 * Android SDK 경로를 자동 탐지해 DeviceManager를 생성한다.
 */
export async function createAndroidDeviceManagerAuto(): Promise<
  ReturnType<typeof createAndroidDeviceManager>
> {
  const sdkPath = await detectAndroidSdkPath();
  if (!sdkPath) {
    throw new E2eError(
      "NO_DEVICE_AVAILABLE",
      "Android SDK를 찾을 수 없습니다. ANDROID_HOME 환경변수를 설정하세요."
    );
  }
  return createAndroidDeviceManager(sdkPath);
}

function buildEnv(sdkPath: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    ANDROID_HOME: sdkPath,
    ANDROID_SDK_ROOT: sdkPath,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
