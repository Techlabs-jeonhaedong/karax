/**
 * checks/adb.ts — adb 설치 여부 + 버전 확인
 */

import { execa } from "execa";
import path from "path";
import { detectAndroidSdkPath } from "./androidSdk.js";
import type { CheckResult } from "./types.js";

export async function checkAdb(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint" | "optional"> = {
    id: "adb",
    label: "adb (Android Debug Bridge)",
    autoInstallable: false,
    optional: true,
    hint:
      "adb가 필요합니다. Android SDK platform-tools를 설치하거나 " +
      "ANDROID_HOME 환경변수를 설정하세요.",
  };

  // SDK platform-tools에서 adb 탐색
  const sdkPath = await detectAndroidSdkPath();
  const adbCandidates: string[] = ["adb"];
  if (sdkPath) {
    adbCandidates.unshift(path.join(sdkPath, "platform-tools", "adb"));
  }

  for (const adbBin of adbCandidates) {
    try {
      const result = await execa(adbBin, ["version"], { timeout: 10_000 });
      const version = extractAdbVersion(String(result.stdout));
      return { ...base, status: "ok", version: version ?? "unknown" };
    } catch {
      // 다음 후보 시도
    }
  }

  return { ...base, status: "missing" };
}

function extractAdbVersion(output: string): string | null {
  const match = /Android Debug Bridge version ([\d.]+)/.exec(output);
  return match ? match[1]! : null;
}
