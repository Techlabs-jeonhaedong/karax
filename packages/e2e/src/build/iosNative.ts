/**
 * build/iosNative.ts — iOS 네이티브 빌더
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execa } from "execa";
import { E2eError } from "../types.js";
import { redactSecrets } from "@karax/core";
import { createDebugArtifacts } from "../debug.js";
import { extractIosBundleId, findDerivedDataApp } from "./artifact.js";
import { parseXcodebuildListJson, selectXcodeScheme } from "./detect.js";
import type { AppBuilder, BuildContext, BuildResult } from "./types.js";

const XCBUILD_TIMEOUT = 600_000;

export class IosNativeBuilder implements AppBuilder {
  readonly framework = "ios";
  readonly platform = "ios" as const;

  private derivedDataPath: string;

  constructor(derivedDataPath?: string) {
    this.derivedDataPath = derivedDataPath ?? path.join(os.tmpdir(), `karax-ios-${Date.now()}`);
  }

  async build(projectPath: string, ctx?: BuildContext): Promise<BuildResult> {
    const artifacts = createDebugArtifacts(ctx?.debug ? ctx.debugDir : undefined);
    const BUILD_5MB = 5 * 1024 * 1024;

    // CocoaPods 확인
    // xcworkspace 또는 xcodeproj가 있고 Pods/ 가 없으면 pod install 필요
    const podsDir = path.join(projectPath, "Pods");
    if (!fs.existsSync(podsDir)) {
      const hasXcworkspace = findXcworkspaceOrProject(projectPath, ".xcworkspace") !== null;
      const hasXcodeproj = findXcworkspaceOrProject(projectPath, ".xcodeproj") !== null;
      if (hasXcworkspace || hasXcodeproj) {
        throw new E2eError(
          "COCOAPODS_REQUIRED",
          "Pods/ 디렉토리가 없습니다. 먼저 `pod install`을 실행해주세요.",
          "COCOAPODS_REQUIRED"
        );
      }
    }

    // xcworkspace 또는 xcodeproj 선택
    const workspacePath = findXcworkspaceOrProject(projectPath, ".xcworkspace");
    const projectXcodeproj = findXcworkspaceOrProject(projectPath, ".xcodeproj");

    const targetPath = workspacePath ?? projectXcodeproj;
    if (!targetPath) {
      throw new E2eError("BUILD_FAILED", "*.xcworkspace 또는 *.xcodeproj를 찾을 수 없습니다.");
    }

    const isWorkspace = targetPath.endsWith(".xcworkspace");
    const targetFlag = isWorkspace ? "-workspace" : "-project";

    // 스킴 선택
    const listResult = await execa(
      "xcodebuild",
      [targetFlag, targetPath, "-list", "-json"],
      { timeout: 30_000 }
    ).catch(() => null);

    let scheme = "MyApp";
    if (listResult) {
      const { schemes } = parseXcodebuildListJson(String(listResult.stdout));
      scheme = selectXcodeScheme(schemes) ?? "MyApp";
    }

    // 빌드
    let buildStdout = "";
    let buildStderr = "";
    let buildExitCode = 0;
    try {
      const buildResult = await execa(
        "xcodebuild",
        [
          targetFlag, targetPath,
          "-scheme", scheme,
          "-sdk", "iphonesimulator",
          "-derivedDataPath", this.derivedDataPath,
          "build",
        ],
        { timeout: XCBUILD_TIMEOUT }
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
        "build-ios-native.log",
        `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `xcodebuild 실패: ${redactSecrets(buildStderr)}`);
    }

    if (buildExitCode !== 0) {
      await artifacts.write(
        "build-ios-native.log",
        `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
        BUILD_5MB
      );
      throw new E2eError("BUILD_FAILED", `xcodebuild 실패: ${redactSecrets(buildStderr)}`);
    }

    await artifacts.write(
      "build-ios-native.log",
      `[stdout]\n${buildStdout}\n\n[stderr]\n${buildStderr}\n\n[exitCode] ${buildExitCode}`,
      BUILD_5MB
    );

    const appPath = findDerivedDataApp(this.derivedDataPath);
    if (!appPath) {
      throw new E2eError("ARTIFACT_NOT_FOUND", "iOS .app을 찾을 수 없습니다.");
    }

    const plistPath = path.join(appPath, "Info.plist");
    let bundleId = "com.example.ios";
    if (fs.existsSync(plistPath)) {
      const content = fs.readFileSync(plistPath, "utf-8");
      bundleId = extractIosBundleId(content) ?? bundleId;
    }

    return { artifactPath: appPath, appId: bundleId };
  }
}

function findXcworkspaceOrProject(dir: string, ext: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(ext) && !entry.startsWith(".")) {
        return path.join(dir, entry);
      }
    }
  } catch {
    // ignore
  }
  return null;
}
