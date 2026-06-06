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
 * simctl list devices available 출력에서 iOS 섹션의 디바이스 이름 목록을 추출한다.
 * 섹션 헤더 패턴: "-- iOS X.Y --" (iOS 섹션만 포함)
 * tvOS / watchOS / visionOS 섹션은 제외한다.
 * 디바이스 행 패턴: "    <name> (<udid>) (<state>)"
 */
function parseAvailableDevices(output: string): string[] {
  const devices: string[] = [];
  let inIosSection = false;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 섹션 헤더 — "-- <platform> X.Y --"
    if (/^--\s/.test(trimmed)) {
      inIosSection = /^--\s+iOS\s+\d/.test(trimmed);
      continue;
    }

    // "== ... ==" 헤더 — 섹션 상태 초기화
    if (/^==/.test(trimmed)) {
      inIosSection = false;
      continue;
    }

    // iOS 섹션 안의 디바이스 행: 괄호 쌍 2개 이상 (UDID, State)
    if (inIosSection && (trimmed.match(/\(/g) ?? []).length >= 2) {
      devices.push(trimmed);
    }
  }

  return devices;
}
