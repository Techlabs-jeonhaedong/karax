/**
 * runtime/dumpAndroid.ts — Android uiautomator dump I/O 어댑터
 *
 * adb를 사용해 런타임 UI를 XML로 덤프한다.
 * deviceId 검증과 adb 경로 해석은 device/android.ts 패턴을 재사용한다.
 */

import path from "node:path";
import { randomBytes } from "node:crypto";
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

const ADB_TIMEOUT = 30_000;

/** 동시 호출 race condition 방지용 고유 덤프 경로 생성 (crypto-random) */
function makeDumpPath(): string {
  const suffix = randomBytes(8).toString("hex");
  return `/sdcard/karax_dump_${suffix}.xml`;
}

/**
 * Android 디바이스에서 uiautomator dump를 실행하고 raw XML을 반환한다.
 *
 * 1. adb -s <id> shell uiautomator dump <path>
 * 2. adb -s <id> exec-out cat <path>  → XML 수신
 * 3. adb -s <id> shell rm -f <path>   → best-effort 정리
 *
 * 호출마다 고유 경로를 사용해 동시 호출 race condition을 방지한다.
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

  const dumpPath = makeDumpPath();

  // 1. uiautomator dump
  try {
    await execa(adbBin, ["-s", deviceId, "shell", "uiautomator", "dump", dumpPath], {
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

  // 2. exec-out cat — XML 수신 + 3. best-effort rm (cat 실패 시에도 rm 보장)
  let xml = "";
  let catError: E2eError | undefined;
  try {
    const catResult = await execa(adbBin, ["-s", deviceId, "exec-out", "cat", dumpPath], {
      timeout: ADB_TIMEOUT,
      env,
    });
    xml = String(catResult.stdout ?? "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    catError = new E2eError(
      "DUMP_FAILED",
      `uiautomator dump 파일 수신 실패 (deviceId: ${deviceId}): ${msg}`
    );
  } finally {
    // cat 성공/실패 무관하게 항상 정리
    await execa(adbBin, ["-s", deviceId, "shell", "rm", "-f", dumpPath], {
      timeout: ADB_TIMEOUT,
      env,
    }).catch(() => {
      // 정리 실패는 무시 (best-effort)
    });
  }

  if (catError) throw catError;

  if (!xml) {
    throw new E2eError(
      "DUMP_FAILED",
      `uiautomator dump 결과가 비어있습니다 (deviceId: ${deviceId}). 디바이스가 잠겨있거나 UI가 없을 수 있습니다.`
    );
  }

  return xml;
}
