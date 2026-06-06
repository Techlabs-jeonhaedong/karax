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

// ── M11: install 옵션 ─────────────────────────────────────────────

export interface InstallOptions {
  /**
   * M11: Android 설치 시 -g 플래그로 모든 권한을 자동 허용한다.
   * iOS: 무시됨 (simctl install은 -g 미지원).
   */
  grantAllPermissions?: boolean;
}

export interface DeviceManager {
  readonly platform: Platform;
  list(): Promise<DeviceInfo[]>;
  ensureBooted(preferredId?: string): Promise<DeviceInfo>;
  install(deviceId: string, artifactPath: string, opts?: InstallOptions): Promise<void>;
  launch(deviceId: string, appId: string): Promise<void>;
  screenshot(deviceId: string, destPngPath: string): Promise<void>;
  shutdown?(deviceId: string): Promise<void>;
  /**
   * M8: logcat 텍스트를 캡처한다 (optional).
   * Android: adb logcat -d でダンプ (best-effort, 실패 시 undefined 반환).
   * iOS: 미구현 (undefined 반환).
   */
  captureLogcat?(deviceId: string): Promise<string | undefined>;
  /**
   * M8: logcat 버퍼를 초기화한다 (optional, best-effort).
   * Android: adb logcat -c
   */
  clearLogcat?(deviceId: string): Promise<void>;
  /**
   * M11: 런타임 권한을 디바이스에 부여한다 (optional).
   * Android: adb shell pm grant <appId> <permission>
   * iOS: xcrun simctl privacy <udid> grant <service> <bundleId>
   */
  grantPermissions?(deviceId: string, appId: string, permissions: string[]): Promise<void>;
}
