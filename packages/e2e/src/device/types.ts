/**
 * device/types.ts — 디바이스 레이어 타입
 */

import type { Platform } from "../types.js";

export type { Platform };

export interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  isEmulator: boolean;
  isBooted: boolean;
}

export interface DeviceManager {
  readonly platform: Platform;
  list(): Promise<DeviceInfo[]>;
  ensureBooted(preferredId?: string): Promise<DeviceInfo>;
  install(deviceId: string, artifactPath: string): Promise<void>;
  launch(deviceId: string, appId: string): Promise<void>;
  screenshot(deviceId: string, destPngPath: string): Promise<void>;
  shutdown?(deviceId: string): Promise<void>;
}
