/**
 * device/parse.ts 순수 파서 단위 테스트
 */

import { describe, it, expect } from "vitest";
import {
  parseAdbDevices,
  parseEmulatorListAvds,
  parseSimctlDevices,
  selectBestSimulator,
} from "../device/parse.js";

// ── adb devices ────────────────────────────────────────────────────

describe("parseAdbDevices", () => {
  it("정상 출력을 파싱한다", () => {
    const output = `List of devices attached
emulator-5554\tdevice
192.168.1.100:5555\toffline`;

    const result = parseAdbDevices(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "emulator-5554", state: "device", isEmulator: true });
    expect(result[1]).toEqual({ id: "192.168.1.100:5555", state: "offline", isEmulator: false });
  });

  it("헤더만 있으면 빈 배열 반환", () => {
    const output = "List of devices attached\n";
    expect(parseAdbDevices(output)).toHaveLength(0);
  });

  it("빈 문자열이면 빈 배열 반환", () => {
    expect(parseAdbDevices("")).toHaveLength(0);
  });

  it("unauthorized 상태를 파싱한다", () => {
    const output = `List of devices attached
emulator-5556\tunauthorized`;
    const result = parseAdbDevices(output);
    expect(result[0]?.state).toBe("unauthorized");
  });

  it("device 상태만 필터링하는 함수가 있다", () => {
    const output = `List of devices attached
emulator-5554\tdevice
emulator-5556\toffline`;
    const result = parseAdbDevices(output).filter((d) => d.state === "device");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("emulator-5554");
  });
});

// ── emulator -list-avds ────────────────────────────────────────────

describe("parseEmulatorListAvds", () => {
  it("AVD 목록을 줄 단위로 파싱한다", () => {
    const output = "Pixel_7_API_34\nPixel_4_API_30\n";
    const result = parseEmulatorListAvds(output);
    expect(result).toEqual(["Pixel_7_API_34", "Pixel_4_API_30"]);
  });

  it("빈 줄을 제거한다", () => {
    const output = "Pixel_7_API_34\n\nPixel_4_API_30\n\n";
    const result = parseEmulatorListAvds(output);
    expect(result).toEqual(["Pixel_7_API_34", "Pixel_4_API_30"]);
  });

  it("빈 문자열이면 빈 배열 반환", () => {
    expect(parseEmulatorListAvds("")).toEqual([]);
  });

  it("공백만 있으면 빈 배열 반환", () => {
    expect(parseEmulatorListAvds("   \n   \n")).toEqual([]);
  });
});

// ── simctl list devices ────────────────────────────────────────────

describe("parseSimctlDevices", () => {
  const sampleOutput = `== Devices ==
-- iOS 17.2 --
    iPhone 15 Pro (ABCD1234-0000-0000-0000-000000000001) (Booted)
    iPhone 15 (ABCD1234-0000-0000-0000-000000000002) (Shutdown)
-- iOS 16.4 --
    iPhone 14 (ABCD1234-0000-0000-0000-000000000003) (Shutdown)
-- tvOS 17.2 --
    Apple TV 4K (3rd generation) (ABCD1234-0000-0000-0000-000000000004) (Shutdown)`;

  it("iOS 디바이스를 파싱한다", () => {
    const result = parseSimctlDevices(sampleOutput);
    const iphones = result.filter((d) => d.name.startsWith("iPhone"));
    expect(iphones).toHaveLength(3);
  });

  it("udid를 올바르게 파싱한다", () => {
    const result = parseSimctlDevices(sampleOutput);
    expect(result[0]?.udid).toBe("ABCD1234-0000-0000-0000-000000000001");
  });

  it("iosVersion을 올바르게 파싱한다", () => {
    const result = parseSimctlDevices(sampleOutput);
    expect(result[0]?.iosVersion).toBe("17.2");
  });

  it("Booted 상태를 올바르게 파싱한다", () => {
    const result = parseSimctlDevices(sampleOutput);
    const booted = result.filter((d) => d.state === "Booted");
    expect(booted).toHaveLength(1);
    expect(booted[0]?.name).toBe("iPhone 15 Pro");
  });

  it("tvOS 등 비iOS 항목은 포함하지 않는다 (iosVersion 없음)", () => {
    const result = parseSimctlDevices(sampleOutput);
    const tvos = result.filter((d) => d.name.includes("Apple TV"));
    expect(tvos).toHaveLength(0);
  });

  it("빈 문자열이면 빈 배열 반환", () => {
    expect(parseSimctlDevices("")).toHaveLength(0);
  });

  it("selectBestSimulator: iPhone 최신 버전을 선택한다", () => {
    const result = selectBestSimulator(sampleOutput);
    expect(result?.name).toContain("iPhone 15");
    expect(result?.iosVersion).toBe("17.2");
  });
});
