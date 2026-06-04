import { execa } from "execa";
import type { CheckResult } from "./types.js";

export async function checkXcodebuild(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "xcodebuild",
    label: "Xcode (xcodebuild + simctl)",
    autoInstallable: false,
    hint: "macOS에서만 사용 가능합니다. App Store에서 Xcode를 설치하세요. iOS Tier 1은 macOS+Xcode 전용입니다.",
  };

  // non-darwin 플랫폼은 즉시 missing
  if (process.platform !== "darwin") {
    return { ...base, status: "missing" };
  }

  try {
    const { stdout } = await execa("xcodebuild", ["-version"]);
    // "Xcode 16.2" 형태 파싱
    const match = stdout.match(/Xcode\s+(\d+(?:\.\d+)?)/);
    if (!match) {
      return { ...base, status: "missing" };
    }

    // simctl 접근 가능 여부 추가 확인
    try {
      await execa("xcrun", ["simctl", "list", "devices", "available"]);
    } catch {
      // simctl 실패해도 xcodebuild 자체는 ok로 처리 (hint에 안내 추가)
      return {
        ...base,
        status: "ok",
        version: match[1],
        hint: "xcodebuild는 있으나 simctl 접근 실패. Xcode License Agreement에 동의했는지 확인: sudo xcodebuild -license accept",
      };
    }

    return { ...base, status: "ok", version: match[1] };
  } catch {
    return { ...base, status: "missing" };
  }
}
