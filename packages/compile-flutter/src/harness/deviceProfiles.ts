import type { DeviceProfileId } from "@karax/adapter-api";

export interface DeviceProfile {
  id: DeviceProfileId;
  /** 논리 픽셀 너비 */
  logicalWidth: number;
  /** 논리 픽셀 높이 */
  logicalHeight: number;
  /** 디바이스 픽셀 비율 */
  devicePixelRatio: number;
}

/** 물리 픽셀 계산 — flutter test physicalSize에 전달하는 값 */
export function physicalSize(profile: DeviceProfile): {
  width: number;
  height: number;
} {
  return {
    width: Math.round(profile.logicalWidth * profile.devicePixelRatio),
    height: Math.round(profile.logicalHeight * profile.devicePixelRatio),
  };
}

export const DEVICE_PROFILES: Record<DeviceProfileId, DeviceProfile> = {
  "iphone-15": {
    id: "iphone-15",
    logicalWidth: 390,
    logicalHeight: 844,
    devicePixelRatio: 3.0,
  },
  "iphone-se": {
    id: "iphone-se",
    logicalWidth: 375,
    logicalHeight: 667,
    devicePixelRatio: 2.0,
  },
  "pixel-8": {
    id: "pixel-8",
    logicalWidth: 412,
    logicalHeight: 915,
    // 실제 물리픽셀 1082x2402 (Math.round(412*2.625)=1082, Math.round(915*2.625)=2402)
    devicePixelRatio: 2.625,
  },
  "pixel-7": {
    id: "pixel-7",
    logicalWidth: 412,
    logicalHeight: 892,
    devicePixelRatio: 2.625,
  },
  "generic-tablet": {
    id: "generic-tablet",
    logicalWidth: 768,
    logicalHeight: 1024,
    devicePixelRatio: 2.0,
  },
};

export function getDeviceProfile(id?: DeviceProfileId): DeviceProfile {
  return DEVICE_PROFILES[id ?? "iphone-15"];
}
