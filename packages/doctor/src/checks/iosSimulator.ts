/**
 * checks/iosSimulator.ts — iOS Simulator 사용 가능 여부 확인
 *
 * `xcrun simctl list devices available` 실행 후 최소 1개 이상의
 * 디바이스가 존재하면 ok, 아니면 missing을 반환한다.
 * non-darwin 플랫폼에서는 즉시 missing.
 */

import { execa } from "execa";
import type { CheckResult } from "./types.js";

export async function checkIosSimulator(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint" | "optional"> = {
    id: "ios-simulator",
    label: "iOS Simulator",
    optional: true,
    autoInstallable: false,
    hint:
      "Xcode > Settings > Platforms에서 iOS Simulator 런타임을 설치하고 시뮬레이터 디바이스를 생성하세요.",
  };

  if (process.platform !== "darwin") {
    return { ...base, status: "missing" };
  }

  try {
    const { stdout } = await execa("xcrun", ["simctl", "list", "devices", "available"], {
      timeout: 15_000,
    });

    const devices = parseAvailableDevices(stdout);

    if (devices.length === 0) {
      return { ...base, status: "missing" };
    }

    return {
      ...base,
      status: "ok",
      version: `${devices.length} device${devices.length > 1 ? "s" : ""}`,
    };
  } catch {
    return { ...base, status: "missing" };
  }
}

/**
 * simctl list devices available 출력에서 디바이스 이름 목록을 추출한다.
 * 디바이스 행 패턴: "    <name> (<udid>) (<state>)"
 * -- 섹션 헤더("== ... ==", "-- ... --")와 빈 줄은 제외한다.
 */
function parseAvailableDevices(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^==/.test(trimmed)) return false;
      if (/^--/.test(trimmed)) return false;
      // 디바이스 행: 괄호 쌍이 2개 이상 포함 (UDID, State)
      return (trimmed.match(/\(/g) ?? []).length >= 2;
    })
    .map((line) => line.trim());
}
