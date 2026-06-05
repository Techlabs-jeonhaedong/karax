/**
 * build/reactNative.ts — React Native 빌더 (android/ios)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execa } from "execa";
import { E2eError } from "../types.js";
import { extractAndroidAppId, extractIosBundleId, findApk, findDerivedDataApp } from "./artifact.js";
import { parseXcodebuildListJson, selectXcodeScheme } from "./detect.js";
import type { AppBuilder, BuildResult } from "./types.js";

const BUILD_TIMEOUT = 600_000;
const XCBUILD_TIMEOUT = 600_000;

export class RnAndroidBuilder implements AppBuilder {
  readonly framework = "react-native";
  readonly platform = "android" as const;

  async build(projectPath: string): Promise<BuildResult> {
    const androidDir = path.join(projectPath, "android");
    const gradlew = path.join(androidDir, "gradlew");

    if (!fs.existsSync(gradlew)) {
      throw new E2eError("BUILD_FAILED", "android/gradlew를 찾을 수 없습니다.");
    }

    // gradlew에 실행 권한 부여
    try {
      fs.chmodSync(gradlew, 0o755);
    } catch {
      // ignore
    }

    const result = await execa(gradlew, ["assembleDebug"], {
      cwd: androidDir,
      timeout: BUILD_TIMEOUT,
    });

    if (result.exitCode !== 0) {
      throw new E2eError("BUILD_FAILED", `gradlew assembleDebug 실패: ${result.stderr}`);
    }

    const apkPath = findApk(androidDir, "app");
    if (!apkPath) {
      throw new E2eError("ARTIFACT_NOT_FOUND", "React Native APK를 찾을 수 없습니다.");
    }

    const buildGradlePath = path.join(androidDir, "app", "build.gradle");
    let appId = "com.example.reactnative";
    if (fs.existsSync(buildGradlePath)) {
      const content = fs.readFileSync(buildGradlePath, "utf-8");
      appId = extractAndroidAppId(content) ?? appId;
    }

    return { artifactPath: apkPath, appId };
  }
}

export class RnIosBuilder implements AppBuilder {
  readonly framework = "react-native";
  readonly platform = "ios" as const;

  private derivedDataPath: string;

  constructor(derivedDataPath?: string) {
    this.derivedDataPath = derivedDataPath ?? path.join(os.tmpdir(), `sfc-rn-ios-${Date.now()}`);
  }

  async build(projectPath: string): Promise<BuildResult> {
    const iosDir = path.join(projectPath, "ios");

    // CocoaPods 확인 (원본 무수정 원칙: pod install 자동 실행 안 함)
    const podsDir = path.join(iosDir, "Pods");
    if (!fs.existsSync(podsDir)) {
      throw new E2eError(
        "COCOAPODS_REQUIRED",
        "ios/Pods/ 디렉토리가 없습니다. 먼저 `cd ios && pod install`을 실행해주세요.",
        "COCOAPODS_REQUIRED"
      );
    }

    // xcworkspace 탐색
    const workspacePath = findXcworkspace(iosDir);
    if (!workspacePath) {
      throw new E2eError("BUILD_FAILED", "ios/*.xcworkspace를 찾을 수 없습니다.");
    }

    // 스킴 선택
    const listResult = await execa(
      "xcodebuild",
      ["-workspace", workspacePath, "-list", "-json"],
      { cwd: iosDir, timeout: 30_000 }
    );
    const { schemes } = parseXcodebuildListJson(String(listResult.stdout));
    const scheme = selectXcodeScheme(schemes);
    if (!scheme) {
      throw new E2eError("BUILD_FAILED", "xcodebuild 스킴을 찾을 수 없습니다.");
    }

    // 빌드
    const buildResult = await execa(
      "xcodebuild",
      [
        "-workspace", workspacePath,
        "-scheme", scheme,
        "-sdk", "iphonesimulator",
        "-derivedDataPath", this.derivedDataPath,
        "build",
      ],
      { cwd: iosDir, timeout: XCBUILD_TIMEOUT }
    );

    if (buildResult.exitCode !== 0) {
      throw new E2eError("BUILD_FAILED", `xcodebuild 실패: ${buildResult.stderr}`);
    }

    const appPath = findDerivedDataApp(this.derivedDataPath);
    if (!appPath) {
      throw new E2eError("ARTIFACT_NOT_FOUND", "RN iOS .app을 찾을 수 없습니다.");
    }

    const plistPath = path.join(appPath, "Info.plist");
    let bundleId = "com.example.reactnative";
    if (fs.existsSync(plistPath)) {
      const content = fs.readFileSync(plistPath, "utf-8");
      bundleId = extractIosBundleId(content) ?? bundleId;
    }

    return { artifactPath: appPath, appId: bundleId };
  }
}

// ── 유틸 ──────────────────────────────────────────────────────────

function findXcworkspace(dir: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".xcworkspace")) return path.join(dir, entry);
    }
  } catch {
    // ignore
  }
  return null;
}
