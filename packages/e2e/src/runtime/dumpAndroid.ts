/**
 * runtime/dumpAndroid.ts — Android uiautomator dump I/O 어댑터
 *
 * adb를 사용해 런타임 UI를 XML로 덤프한다.
 * deviceId 검증과 adb 경로 해석은 device/android.ts 패턴을 재사용한다.
 */

import path from "node:path";
import { execa } from "execa";
import { detectAndroidSdkPath } from "@karax/doctor";
import { E2eError } from "../types.js";

/** device/android.ts와 동일한 deviceId 검증 정규식 */
export const DEVICE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_:.\-]*$/;

function validateDeviceId(deviceId: string): void {
  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    throw new E2eError(
      "INVALID_ARGUMENT",
      `유효하지 않은 deviceId: "${deviceId}". 영숫자·'_'·':'·'.'·'-'만 허용, '-'로 시작 불가.`
    );
  }
}

const DUMP_PATH = "/sdcard/karax_window_dump.xml";
const ADB_TIMEOUT = 30_000;

/**
 * Android 디바이스에서 uiautomator dump를 실행하고 raw XML을 반환한다.
 *
 * 1. adb -s <id> shell uiautomator dump <path>
 * 2. adb -s <id> exec-out cat <path>  → XML 수신
 * 3. adb -s <id> shell rm -f <path>   → best-effort 정리
 */
export async function dumpAndroidUI(deviceId: string): Promise<string> {
  validateDeviceId(deviceId);

  const sdkPath = await detectAndroidSdkPath();
  const adbBin = sdkPath
    ? path.join(sdkPath, "platform-tools", "adb")
    : "adb";

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(sdkPath ? { ANDROID_HOME: sdkPath, ANDROID_SDK_ROOT: sdkPath } : {}),
  };

  // 1. uiautomator dump
  try {
    await execa(adbBin, ["-s", deviceId, "shell", "uiautomator", "dump", DUMP_PATH], {
      timeout: ADB_TIMEOUT,
      env,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new E2eError(
      "DUMP_FAILED",
      `uiautomator dump 실패 (deviceId: ${deviceId}): ${msg}`
    );
  }

  // 2. exec-out cat — XML 수신
  let xml: string;
  try {
    const result = await execa(adbBin, ["-s", deviceId, "exec-out", "cat", DUMP_PATH], {
      timeout: ADB_TIMEOUT,
      env,
    });
    xml = String(result.stdout ?? "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new E2eError(
      "DUMP_FAILED",
      `uiautomator dump 파일 수신 실패 (deviceId: ${deviceId}): ${msg}`
    );
  }

  // 3. best-effort rm
  try {
    await execa(adbBin, ["-s", deviceId, "shell", "rm", "-f", DUMP_PATH], {
      timeout: ADB_TIMEOUT,
      env,
    });
  } catch {
    // 정리 실패는 무시 (best-effort)
  }

  if (!xml) {
    throw new E2eError(
      "DUMP_FAILED",
      `uiautomator dump 결과가 비어있습니다 (deviceId: ${deviceId}). 디바이스가 잠겨있거나 UI가 없을 수 있습니다.`
    );
  }

  return xml;
}
