import { describe, expect, it } from "vitest";
import { DEVICE_PROFILES, getDeviceProfile } from "../devices/profiles.js";

describe("DeviceProfile", () => {
  it("iphone-15 프로파일이 올바른 값을 가짐", () => {
    const profile = getDeviceProfile("iphone-15");
    expect(profile.id).toBe("iphone-15");
    expect(profile.width).toBe(393);
    expect(profile.height).toBe(852);
    expect(profile.deviceScaleFactor).toBe(3);
    expect(profile.safeAreaTop).toBe(59);
    expect(profile.safeAreaBottom).toBe(34);
    expect(typeof profile.fontStack).toBe("string");
    expect(profile.fontStack.length).toBeGreaterThan(0);
  });

  it("pixel-8 프로파일이 올바른 값을 가짐", () => {
    const profile = getDeviceProfile("pixel-8");
    expect(profile.id).toBe("pixel-8");
    expect(profile.width).toBe(412);
    expect(profile.height).toBe(915);
    expect(profile.deviceScaleFactor).toBeCloseTo(2.625);
    expect(profile.safeAreaTop).toBe(48);
    expect(profile.safeAreaBottom).toBe(24);
    expect(typeof profile.fontStack).toBe("string");
  });

  it("DEVICE_PROFILES에 두 디바이스 모두 포함됨", () => {
    expect(DEVICE_PROFILES).toHaveProperty("iphone-15");
    expect(DEVICE_PROFILES).toHaveProperty("pixel-8");
  });

  it("알 수 없는 디바이스 ID는 에러를 던짐", () => {
    expect(() => getDeviceProfile("unknown-device")).toThrow();
  });

  it("모든 프로파일의 safeAreaTop이 0 이상임", () => {
    for (const profile of Object.values(DEVICE_PROFILES)) {
      expect(profile.safeAreaTop).toBeGreaterThanOrEqual(0);
      expect(profile.safeAreaBottom).toBeGreaterThanOrEqual(0);
    }
  });
});
