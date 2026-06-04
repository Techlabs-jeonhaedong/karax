import { access } from "fs/promises";
import path from "path";
import type { CheckResult } from "./types.js";

const ANDROID_SDK_PATHS = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(process.env.HOME ?? "~", "Library", "Android", "sdk"),   // macOS
  path.join(process.env.HOME ?? "~", "Android", "Sdk"),               // Linux
  "C:\\Users\\Public\\Android\\Sdk",                                   // Windows
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Android SDK 루트 경로를 탐지한다. 없으면 null 반환. */
export async function detectAndroidSdkPath(): Promise<string | null> {
  for (const candidate of ANDROID_SDK_PATHS) {
    if (!candidate) continue;
    if (await pathExists(candidate)) {
      // platform-tools 존재로 SDK 완전성 확인
      if (await pathExists(path.join(candidate, "platform-tools"))) {
        return candidate;
      }
      // platform-tools 없어도 SDK 루트로 인정 (최소 구성)
      return candidate;
    }
  }
  return null;
}

export async function checkAndroidSdk(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "android-sdk",
    label: "Android SDK",
    autoInstallable: false,
    hint:
      "Android SDK가 필요합니다. Android Studio를 설치하거나 " +
      "ANDROID_HOME 환경변수를 설정하세요. https://developer.android.com/studio",
  };

  const sdkPath = await detectAndroidSdkPath();
  if (!sdkPath) {
    return { ...base, status: "missing" };
  }

  return { ...base, status: "ok", version: sdkPath };
}
