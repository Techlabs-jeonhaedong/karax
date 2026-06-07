/**
 * build/flutter.ts — Flutter 빌더 (android/ios)
 */

import fs from "fs";
import path from "path";
import { execa } from "execa";
import { resolveFlutterPath } from "@karax/adapter-api";
import { E2eError } from "../types.js";
import { redactSecrets } from "@karax/core";
import { createDebugArtifacts } from "../debug.js";
import { extractAndroidAppId, extractIosBundleId, findFlutterApk, findFlutterIosApp, findDerivedDataApp } from "./artifact.js";
import type { AppBuilder, BuildContext, BuildResult } from "./types.js";

/**
 * 프로젝트 경로 기반으로 flutter 실행파일을 결정한다.
 * FVM 설정이 있으면 FVM SDK를, 없으면 시스템 "flutter"를 사용한다.
 */
async function getFlutterExecutable(projectPath: string): Promise<string> {
  const fvmPath = await resolveFlutterPath(projectPath);
  return fvmPath ?? "flutter";
}

const BUILD_TIMEOUT = 600_000;

export class FlutterAndroidBuilder implements AppBuilder {
  readonly framework = "flutter";
  readonly platform = "android" as const;

  async build(projectPath: string, ctx?: BuildContext): Promise<BuildResult> {
    const flutterBin = await getFlutterExecutable(projectPath);
    const artifacts = createDebugArtifacts(ctx?.debug ? ctx.debugDir : undefined);
    const BUILD_5MB = 5 * 1024 * 1024;

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const result = await execa(flutterBin, ["build", "apk", "--debug"], {
        cwd: projectPath,
        timeout: BUILD_TIMEOUT,
      });
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
      exitCode = result.exitCode ?? 0;
    } catch (e) {
      // ExecaError: non-zero exit → stdout/stderr는 e에서 추출
      const err = e as { stdout?: string; stderr?: string; exitCode?: number };
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      exitCode = err.exitCode ?? 1;
      // debug 시 빌드 로그 기록 (실패)
      await artifacts.write(
        "build-flutter-android.log",
        `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `flutter build apk 실패: ${redactSecrets(stderr)}`);
    }

    if (exitCode !== 0) {
      await artifacts.write(
        "build-flutter-android.log",
        `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `flutter build apk 실패: ${redactSecrets(stderr)}`);
    }

    // 성공 시에도 debug이면 로그 기록
    await artifacts.write(
      "build-flutter-android.log",
      `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
      BUILD_5MB
    );

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

  async build(projectPath: string, ctx?: BuildContext): Promise<BuildResult> {
    const flutterBin = await getFlutterExecutable(projectPath);
    const artifacts = createDebugArtifacts(ctx?.debug ? ctx.debugDir : undefined);
    const BUILD_5MB = 5 * 1024 * 1024;

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const result = await execa(
        flutterBin,
        ["build", "ios", "--simulator", "--debug"],
        { cwd: projectPath, timeout: BUILD_TIMEOUT }
      );
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
      exitCode = result.exitCode ?? 0;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; exitCode?: number };
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      exitCode = err.exitCode ?? 1;
      await artifacts.write(
        "build-flutter-ios.log",
        `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `flutter build ios 실패: ${redactSecrets(stderr)}`);
    }

    if (exitCode !== 0) {
      await artifacts.write(
        "build-flutter-ios.log",
        `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `flutter build ios 실패: ${redactSecrets(stderr)}`);
    }

    await artifacts.write(
      "build-flutter-ios.log",
      `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
      BUILD_5MB
    );

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
