export interface DeviceProfile {
  id: string;
  /** 논리 픽셀 너비 (dp/pt) */
  width: number;
  /** 논리 픽셀 높이 (dp/pt) */
  height: number;
  /** 물리 픽셀 배율 */
  deviceScaleFactor: number;
  /** 상단 safe area (논리px) — status bar 포함 */
  safeAreaTop: number;
  /** 하단 safe area (논리px) — home indicator 포함 */
  safeAreaBottom: number;
  /** CSS font-family 스택 */
  fontStack: string;
}

export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  "iphone-15": {
    id: "iphone-15",
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    safeAreaTop: 59,
    safeAreaBottom: 34,
    fontStack: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  },
  "pixel-8": {
    id: "pixel-8",
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    safeAreaTop: 48,
    safeAreaBottom: 24,
    fontStack: "'Inter', 'Google Sans', Roboto, 'Noto Sans', sans-serif",
  },
};

export function getDeviceProfile(id: string): DeviceProfile {
  const profile = DEVICE_PROFILES[id];
  if (!profile) {
    throw new Error(
      `Unknown device profile: "${id}". Available: ${Object.keys(DEVICE_PROFILES).join(", ")}`,
    );
  }
  return profile;
}
