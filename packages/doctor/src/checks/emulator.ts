/**
 * checks/emulator.ts — emulator 바이너리 + AVD 존재 확인 (`emulator -list-avds` 사용)
 */

import { execa } from "execa";
import path from "path";
import { detectAndroidSdkPath } from "./androidSdk.js";
import type { CheckResult } from "./types.js";

export async function checkEmulator(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint" | "optional"> = {
    id: "android-emulator",
    label: "Android Emulator",
    autoInstallable: false,
    optional: true,
    hint:
      "Android Emulator가 필요합니다. Android Studio의 SDK Manager에서 " +
      "'Android Emulator'를 설치하고 AVD를 생성해주세요.",
  };

  const sdkPath = await detectAndroidSdkPath();
  if (!sdkPath) {
    return { ...base, status: "missing" };
  }

  const emulatorBin = path.join(sdkPath, "emulator", "emulator");

  // emulator 버전 확인
  try {
    const result = await execa(emulatorBin, ["-version"], { timeout: 10_000 });
    const version = extractEmulatorVersion(String(result.stdout) + String(result.stderr));

    // AVD 목록 확인
    const avdResult = await execa(emulatorBin, ["-list-avds"], { timeout: 10_000 }).catch(() => null);
    const avds = avdResult
      ? String(avdResult.stdout).split("\n").map((l) => l.trim()).filter(Boolean)
      : [];

    if (avds.length === 0) {
      return {
        ...base,
        status: "missing",
        hint: `Android Emulator는 설치되어 있지만 AVD가 없습니다. ` +
          "Android Studio > AVD Manager에서 가상 기기를 생성해주세요.",
        version: version ?? undefined,
      };
    }

    return {
      ...base,
      status: "ok",
      version: `${version ?? "unknown"} (AVDs: ${avds.join(", ")})`,
    };
  } catch {
    return { ...base, status: "missing" };
  }
}

function extractEmulatorVersion(output: string): string | null {
  const match = /Android emulator version ([\d.]+)/.exec(output);
  return match ? match[1]! : null;
}
