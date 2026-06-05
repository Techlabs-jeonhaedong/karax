/**
 * build/*.ts 빌더 단위 테스트 (execa mock)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { E2eError } from "../types.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("@karax/doctor", () => ({
  detectAndroidSdkPath: vi.fn().mockResolvedValue("/sdk"),
}));

import { execa } from "execa";
import { FlutterAndroidBuilder, FlutterIosBuilder } from "../build/flutter.js";
import { RnAndroidBuilder, RnIosBuilder } from "../build/reactNative.js";
import { AndroidNativeBuilder } from "../build/androidNative.js";
import { IosNativeBuilder } from "../build/iosNative.js";

const mockExeca = vi.mocked(execa);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-build-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── flutter/android ────────────────────────────────────────────────

describe("FlutterAndroidBuilder", () => {
  it("flutter build apk --debug 를 호출한다", async () => {
    const apkPath = path.join(tmpDir, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
    fs.mkdirSync(path.dirname(apkPath), { recursive: true });
    fs.writeFileSync(apkPath, "fake-apk");

    const gradlePath = path.join(tmpDir, "android", "app", "build.gradle");
    fs.mkdirSync(path.dirname(gradlePath), { recursive: true });
    fs.writeFileSync(gradlePath, 'applicationId "com.example.flutter"');

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new FlutterAndroidBuilder();
    const result = await builder.build(tmpDir);

    expect(mockExeca).toHaveBeenCalledWith(
      "flutter",
      expect.arrayContaining(["build", "apk", "--debug"]),
      expect.any(Object)
    );
    expect(result.artifactPath).toBe(apkPath);
    expect(result.appId).toBe("com.example.flutter");
  });

  it("빌드 실패 시 BUILD_FAILED 에러를 던진다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "Flutter error", exitCode: 1 });

    const builder = new FlutterAndroidBuilder();
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "BUILD_FAILED" });
  });
});

// ── rn/android ────────────────────────────────────────────────────

describe("RnAndroidBuilder", () => {
  it("gradlew assembleDebug 를 호출한다", async () => {
    const gradlew = path.join(tmpDir, "android", "gradlew");
    fs.mkdirSync(path.dirname(gradlew), { recursive: true });
    fs.writeFileSync(gradlew, "#!/bin/sh");

    const apkDir = path.join(tmpDir, "android", "app", "build", "outputs", "apk", "debug");
    fs.mkdirSync(apkDir, { recursive: true });
    fs.writeFileSync(path.join(apkDir, "app-debug.apk"), "fake-apk");

    const buildGradle = path.join(tmpDir, "android", "app", "build.gradle");
    fs.writeFileSync(buildGradle, 'applicationId "com.example.rn"');

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new RnAndroidBuilder();
    const result = await builder.build(tmpDir);

    expect(mockExeca).toHaveBeenCalledWith(
      expect.stringContaining("gradlew"),
      expect.arrayContaining(["assembleDebug"]),
      expect.any(Object)
    );
    expect(result.appId).toBe("com.example.rn");
  });
});

// ── ios native ─────────────────────────────────────────────────────

describe("IosNativeBuilder", () => {
  it("Pods/ 없으면 COCOAPODS_REQUIRED 에러를 던진다", async () => {
    // xcodeproj 파일 생성
    const xcodeproj = path.join(tmpDir, "MyApp.xcodeproj");
    fs.mkdirSync(xcodeproj);

    // Pods/ 없음
    const builder = new IosNativeBuilder("/tmp/derived");
    await expect(builder.build(tmpDir)).rejects.toMatchObject({
      code: "COCOAPODS_REQUIRED",
    });
  });

  it("xcodebuild -list -json 및 빌드 커맨드를 호출한다", async () => {
    // Pods/ 생성
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });

    // xcworkspace
    const workspace = path.join(tmpDir, "MyApp.xcworkspace");
    fs.mkdirSync(workspace);

    // xcodebuild -list 응답
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ workspace: { schemes: ["MyApp"] } }),
      stderr: "",
      exitCode: 0,
    });

    // xcodebuild build 응답
    mockExeca.mockResolvedValueOnce({ stdout: "** BUILD SUCCEEDED **", stderr: "", exitCode: 0 });

    // derivedDataPath를 tmpDir 기반으로 설정해 테스트 격리 보장
    const derivedDataPath = path.join(tmpDir, "derived");
    const appPath = path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "MyApp.app");
    fs.mkdirSync(appPath, { recursive: true });
    const plistContent = `<plist><dict><key>CFBundleIdentifier</key><string>com.example.ios</string></dict></plist>`;
    fs.writeFileSync(path.join(appPath, "Info.plist"), plistContent);

    const builder = new IosNativeBuilder(derivedDataPath);
    const result = await builder.build(tmpDir);

    expect(result.appId).toBe("com.example.ios");
  });
});
