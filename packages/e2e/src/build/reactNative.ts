/**
 * build/reactNative.ts — React Native 빌더 (android/ios)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execa } from "execa";
import { E2eError } from "../types.js";
import { redactSecrets } from "@karax/core";
import { createDebugArtifacts } from "../debug.js";
import { extractAndroidAppId, extractIosBundleId, findApk, findDerivedDataApp, findIosStandardApp } from "./artifact.js";
import { parseXcodebuildListJson, selectXcodeScheme } from "./detect.js";
import type { AppBuilder, BuildContext, BuildResult } from "./types.js";

const BUILD_TIMEOUT = 600_000;
const XCBUILD_TIMEOUT = 600_000;

export class RnAndroidBuilder implements AppBuilder {
  readonly framework = "react-native";
  readonly platform = "android" as const;

  async build(projectPath: string, ctx?: BuildContext): Promise<BuildResult> {
    const artifacts = createDebugArtifacts(ctx?.debug ? ctx.debugDir : undefined);
    const BUILD_5MB = 5 * 1024 * 1024;
    const androidDir = path.join(projectPath, "android");

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    if (ctx?.buildCommand) {
      // 사용자 정의 빌드 커맨드: shell=true로 projectPath에서 실행 (gradlew 체크 스킵)
      try {
        const result = await execa(ctx.buildCommand, [], {
          shell: true,
          cwd: projectPath,
          timeout: BUILD_TIMEOUT,
        });
        stdout = result.stdout ?? "";
        stderr = result.stderr ?? "";
        exitCode = result.exitCode ?? 0;
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; exitCode?: number };
        stdout = err.stdout ?? "";
        stderr = err.stderr ?? "";
        exitCode = err.exitCode ?? 1;
        await artifacts.write(
          "build-rn-android.log",
          `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `사용자 빌드 커맨드 실패: ${redactSecrets(stderr)}`);
      }

      if (exitCode !== 0) {
        await artifacts.write(
          "build-rn-android.log",
          `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `사용자 빌드 커맨드 실패: ${redactSecrets(stderr)}`);
      }
    } else {
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

      try {
        const result = await execa(gradlew, ["assembleDebug"], {
          cwd: androidDir,
          timeout: BUILD_TIMEOUT,
        });
        stdout = result.stdout ?? "";
        stderr = result.stderr ?? "";
        exitCode = result.exitCode ?? 0;
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; exitCode?: number };
        stdout = err.stdout ?? "";
        stderr = err.stderr ?? "";
        exitCode = err.exitCode ?? 1;
        await artifacts.write(
          "build-rn-android.log",
          `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `gradlew assembleDebug 실패: ${redactSecrets(stderr)}`);
      }

      if (exitCode !== 0) {
        await artifacts.write(
          "build-rn-android.log",
          `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `gradlew assembleDebug 실패: ${redactSecrets(stderr)}`);
      }
    }

    await artifacts.write(
      "build-rn-android.log",
      `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
      BUILD_5MB
    );

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
    this.derivedDataPath = derivedDataPath ?? path.join(os.tmpdir(), `karax-rn-ios-${Date.now()}`);
  }

  async build(projectPath: string, ctx?: BuildContext): Promise<BuildResult> {
    const artifacts = createDebugArtifacts(ctx?.debug ? ctx.debugDir : undefined);
    const BUILD_5MB = 5 * 1024 * 1024;
    const iosDir = path.join(projectPath, "ios");

    let buildStdout = "";
    let buildStderr = "";
    let buildExitCode = 0;

    if (ctx?.buildCommand) {
      // 사용자 정의 빌드 커맨드: shell=true로 projectPath에서 실행 (CocoaPods·xcworkspace 체크 스킵)
      // KARAX_DERIVED_DATA_PATH를 env에 주입 — 커맨드에서 -derivedDataPath "$KARAX_DERIVED_DATA_PATH"로 활용 가능
      try {
        const buildResult = await execa(ctx.buildCommand, [], {
          shell: true,
          cwd: projectPath,
          timeout: XCBUILD_TIMEOUT,
          env: { ...process.env, KARAX_DERIVED_DATA_PATH: this.derivedDataPath },
        });
        buildStdout = buildResult.stdout ?? "";
        buildStderr = buildResult.stderr ?? "";
        buildExitCode = buildResult.exitCode ?? 0;
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; exitCode?: number };
        buildStdout = err.stdout ?? "";
        buildStderr = err.stderr ?? "";
        buildExitCode = err.exitCode ?? 1;
        await artifacts.write(
          "build-rn-ios.log",
          `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `사용자 빌드 커맨드 실패: ${redactSecrets(buildStderr)}`);
      }

      if (buildExitCode !== 0) {
        await artifacts.write(
          "build-rn-ios.log",
          `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `사용자 빌드 커맨드 실패: ${redactSecrets(buildStderr)}`);
      }
    } else {
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
      try {
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
        buildStdout = buildResult.stdout ?? "";
        buildStderr = buildResult.stderr ?? "";
        buildExitCode = buildResult.exitCode ?? 0;
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; exitCode?: number };
        buildStdout = err.stdout ?? "";
        buildStderr = err.stderr ?? "";
        buildExitCode = err.exitCode ?? 1;
        await artifacts.write(
          "build-rn-ios.log",
          `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `xcodebuild 실패: ${redactSecrets(buildStderr)}`);
      }

      if (buildExitCode !== 0) {
        await artifacts.write(
          "build-rn-ios.log",
          `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
          BUILD_5MB
        );
        throw new E2eError("BUILD_FAILED", `xcodebuild 실패: ${redactSecrets(buildStderr)}`);
      }
    }

    await artifacts.write(
      "build-rn-ios.log",
      `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
      BUILD_5MB
    );

    // 아티팩트 탐색: buildCommand 사용 시 다단계 fallback
    let appPath: string | null = findDerivedDataApp(this.derivedDataPath);
    if (!appPath && ctx?.buildCommand) {
      appPath = findIosStandardApp(projectPath);
    }
    if (!appPath) {
      const hint = ctx?.buildCommand
        ? ' 사용자 빌드 커맨드 사용 시 -derivedDataPath "$KARAX_DERIVED_DATA_PATH"를 커맨드에 포함하면 karax가 산출물을 찾을 수 있습니다.'
        : "";
      throw new E2eError("ARTIFACT_NOT_FOUND", `RN iOS .app을 찾을 수 없습니다.${hint}`);
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
