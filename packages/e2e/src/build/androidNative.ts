/**
 * build/androidNative.ts — Android 네이티브 빌더
 */

import fs from "fs";
import path from "path";
import { execa } from "execa";
import { detectAndroidSdkPath } from "@karax/doctor";
import { E2eError } from "../types.js";
import { redactSecrets } from "@karax/core";
import { createDebugArtifacts } from "../debug.js";
import { extractAndroidAppId, findApk } from "./artifact.js";
import { detectGradleAppModule } from "./detect.js";
import type { AppBuilder, BuildContext, BuildResult } from "./types.js";

const BUILD_TIMEOUT = 600_000;

export class AndroidNativeBuilder implements AppBuilder {
  readonly framework = "android";
  readonly platform = "android" as const;

  async build(projectPath: string, ctx?: BuildContext): Promise<BuildResult> {
    const artifacts = createDebugArtifacts(ctx?.debug ? ctx.debugDir : undefined);
    const BUILD_5MB = 5 * 1024 * 1024;

    // settings.gradle / settings.gradle.kts 탐색
    const settingsContent = readFileIfExists(path.join(projectPath, "settings.gradle"))
      ?? readFileIfExists(path.join(projectPath, "settings.gradle.kts"))
      ?? "";

    const appModule = detectGradleAppModule(settingsContent, null);
    const buildGradlePath = path.join(projectPath, appModule, "build.gradle");
    const buildGradleContent = readFileIfExists(buildGradlePath)
      ?? readFileIfExists(path.join(projectPath, appModule, "build.gradle.kts"))
      ?? "";

    // gradlew 찾기
    const gradlew = resolveGradlew(projectPath);

    // SDK 경로 env 주입
    const sdkPath = await detectAndroidSdkPath();
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };
    if (sdkPath) {
      env["ANDROID_HOME"] = sdkPath;
      env["ANDROID_SDK_ROOT"] = sdkPath;
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      let result;
      if (ctx?.buildCommand) {
        // 사용자 정의 빌드 커맨드: shell=true로 실행
        result = await execa(ctx.buildCommand, [], {
          shell: true,
          cwd: projectPath,
          timeout: BUILD_TIMEOUT,
          env,
        });
      } else {
        result = await execa(
          gradlew,
          [`:${appModule}:assembleDebug`, "--no-daemon"],
          { cwd: projectPath, timeout: BUILD_TIMEOUT, env }
        );
      }
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
      exitCode = result.exitCode ?? 0;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; exitCode?: number };
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      exitCode = err.exitCode ?? 1;
      await artifacts.write(
        "build-android-native.log",
        `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `Gradle assembleDebug 실패: ${redactSecrets(stderr)}`);
    }

    if (exitCode !== 0) {
      await artifacts.write(
        "build-android-native.log",
        `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `Gradle assembleDebug 실패: ${redactSecrets(stderr)}`);
    }

    await artifacts.write(
      "build-android-native.log",
      `[stdout]\n${stdout}\n\n[stderr]\n${stderr}\n\n[exitCode] ${exitCode}`,
      BUILD_5MB
    );

    const apkPath = findApk(projectPath, appModule);
    if (!apkPath) {
      throw new E2eError("ARTIFACT_NOT_FOUND", "Android APK를 찾을 수 없습니다.");
    }

    const appId = extractAndroidAppId(buildGradleContent) ?? "com.example.android";

    return { artifactPath: apkPath, appId };
  }
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function resolveGradlew(projectPath: string): string {
  const gradlew = path.join(projectPath, "gradlew");
  if (fs.existsSync(gradlew)) {
    try { fs.chmodSync(gradlew, 0o755); } catch { /* ignore */ }
    return gradlew;
  }
  const gradlewBat = path.join(projectPath, "gradlew.bat");
  if (fs.existsSync(gradlewBat)) return gradlewBat;
  return "gradle";
}
