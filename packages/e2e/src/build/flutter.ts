/**
 * build/flutter.ts — Flutter 빌더 (android/ios)
 */

import fs from "fs";
import path from "path";
import { execa } from "execa";
import { E2eError } from "../types.js";
import { extractAndroidAppId, extractIosBundleId, findFlutterApk, findFlutterIosApp, findDerivedDataApp } from "./artifact.js";
import type { AppBuilder, BuildResult } from "./types.js";

const BUILD_TIMEOUT = 600_000;

export class FlutterAndroidBuilder implements AppBuilder {
  readonly framework = "flutter";
  readonly platform = "android" as const;

  async build(projectPath: string): Promise<BuildResult> {
    const result = await execa("flutter", ["build", "apk", "--debug"], {
      cwd: projectPath,
      timeout: BUILD_TIMEOUT,
    });

    if (result.exitCode !== 0) {
      throw new E2eError("BUILD_FAILED", `flutter build apk 실패: ${result.stderr}`);
    }

    const apkPath = findFlutterApk(projectPath);
    if (!apkPath) {
      throw new E2eError("ARTIFACT_NOT_FOUND", "flutter APK를 찾을 수 없습니다.");
    }

    const appId = extractAppIdFromFlutterAndroid(projectPath) ?? "com.example.flutter";

    return { artifactPath: apkPath, appId };
  }
}

export class FlutterIosBuilder implements AppBuilder {
  readonly framework = "flutter";
  readonly platform = "ios" as const;

  async build(projectPath: string): Promise<BuildResult> {
    const result = await execa(
      "flutter",
      ["build", "ios", "--simulator", "--debug"],
      { cwd: projectPath, timeout: BUILD_TIMEOUT }
    );

    if (result.exitCode !== 0) {
      throw new E2eError("BUILD_FAILED", `flutter build ios 실패: ${result.stderr}`);
    }

    const appPath = findFlutterIosApp(projectPath);
    if (!appPath) {
      throw new E2eError("ARTIFACT_NOT_FOUND", "flutter iOS .app을 찾을 수 없습니다.");
    }

    const bundleId = extractBundleIdFromApp(appPath) ?? "com.example.flutter";

    return { artifactPath: appPath, appId: bundleId };
  }
}

// ── 유틸 ──────────────────────────────────────────────────────────

function extractAppIdFromFlutterAndroid(projectPath: string): string | null {
  const buildGradlePath = path.join(projectPath, "android", "app", "build.gradle");
  if (!fs.existsSync(buildGradlePath)) return null;
  const content = fs.readFileSync(buildGradlePath, "utf-8");
  return extractAndroidAppId(content);
}

function extractBundleIdFromApp(appPath: string): string | null {
  const plistPath = path.join(appPath, "Info.plist");
  if (!fs.existsSync(plistPath)) return null;
  const content = fs.readFileSync(plistPath, "utf-8");
  return extractIosBundleId(content);
}
