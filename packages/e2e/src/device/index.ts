/**
 * device/index.ts — DeviceManager 팩토리
 */

import type { Platform } from "../types.js";
import type { DeviceManager } from "./types.js";
import { createAndroidDeviceManagerAuto } from "./android.js";
import { createIosDeviceManager } from "./ios.js";

export type { DeviceManager, DeviceInfo } from "./types.js";

/**
 * 플랫폼에 맞는 DeviceManager를 생성한다.
 */
export async function createDeviceManager(platform: Platform): Promise<DeviceManager> {
  if (platform === "android") {
    return createAndroidDeviceManagerAuto();
  }
  return createIosDeviceManager();
}
