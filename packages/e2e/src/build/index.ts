/**
 * build/index.ts — AppBuilder 팩토리
 */

import type { Platform } from "../types.js";
import type { AppBuilder } from "./types.js";
import { FlutterAndroidBuilder, FlutterIosBuilder } from "./flutter.js";
import { RnAndroidBuilder, RnIosBuilder } from "./reactNative.js";
import { AndroidNativeBuilder } from "./androidNative.js";
import { IosNativeBuilder } from "./iosNative.js";

export type { AppBuilder, BuildResult } from "./types.js";
export type FrameworkKind = "flutter" | "react-native" | "android" | "ios";

/**
 * 프레임워크와 플랫폼에 맞는 AppBuilder를 반환한다.
 */
export function selectBuilder(
  framework: FrameworkKind,
  platform: Platform,
  opts?: { derivedDataPath?: string }
): AppBuilder {
  switch (`${framework}/${platform}`) {
    case "flutter/android":
      return new FlutterAndroidBuilder();
    case "flutter/ios":
      return new FlutterIosBuilder();
    case "react-native/android":
      return new RnAndroidBuilder();
    case "react-native/ios":
      return new RnIosBuilder(opts?.derivedDataPath);
    case "android/android":
      return new AndroidNativeBuilder();
    case "ios/ios":
      return new IosNativeBuilder(opts?.derivedDataPath);
    default:
      throw new Error(`지원하지 않는 framework/platform 조합: ${framework}/${platform}`);
  }
}
