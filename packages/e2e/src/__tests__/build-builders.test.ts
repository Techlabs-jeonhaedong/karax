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
import { selectBuilder } from "../build/index.js";

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

  it("BUILD_FAILED 에러를 던진다 (빌드 실패)", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    const workspace = path.join(tmpDir, "App.xcworkspace");
    fs.mkdirSync(workspace);

    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ workspace: { schemes: ["App"] } }),
      stderr: "",
      exitCode: 0,
    });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "xcodebuild error", exitCode: 1 });

    const builder = new IosNativeBuilder(path.join(tmpDir, "derived"));
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "BUILD_FAILED" });
  });

  it("ARTIFACT_NOT_FOUND — .app 없으면 에러", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    const workspace = path.join(tmpDir, "App.xcworkspace");
    fs.mkdirSync(workspace);

    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ workspace: { schemes: ["App"] } }),
      stderr: "",
      exitCode: 0,
    });
    mockExeca.mockResolvedValueOnce({ stdout: "** BUILD SUCCEEDED **", stderr: "", exitCode: 0 });

    const derivedDataPath = path.join(tmpDir, "derived-empty");
    // Build/Products 디렉토리 없음
    const builder = new IosNativeBuilder(derivedDataPath);
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });
});

// ── flutter/ios ─────────────────────────────────────────────────────

describe("FlutterIosBuilder", () => {
  it("flutter build ios --simulator --debug 를 호출한다", async () => {
    const simDir = path.join(tmpDir, "build", "ios", "iphonesimulator");
    const appDir = path.join(simDir, "Runner.app");
    fs.mkdirSync(appDir, { recursive: true });
    const plistContent = `<plist><dict><key>CFBundleIdentifier</key><string>com.example.flutterios</string></dict></plist>`;
    fs.writeFileSync(path.join(appDir, "Info.plist"), plistContent);

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new FlutterIosBuilder();
    const result = await builder.build(tmpDir);

    expect(mockExeca).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["build", "ios", "--simulator", "--debug"]),
      expect.any(Object)
    );
    expect(result.artifactPath).toBe(appDir);
    expect(result.appId).toBe("com.example.flutterios");
  });

  it("BUILD_FAILED 에러를 던진다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "Flutter ios error", exitCode: 1 });

    const builder = new FlutterIosBuilder();
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "BUILD_FAILED" });
  });

  it("ARTIFACT_NOT_FOUND — .app 없으면 에러", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    // iphonesimulator 디렉토리 없음

    const builder = new FlutterIosBuilder();
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });

  it("Info.plist에서 bundleId를 추출한다", async () => {
    const simDir = path.join(tmpDir, "build", "ios", "iphonesimulator");
    const appDir = path.join(simDir, "MyApp.app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "Info.plist"),
      `<plist><dict><key>CFBundleIdentifier</key><string>com.my.bundleid</string></dict></plist>`
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new FlutterIosBuilder();
    const result = await builder.build(tmpDir);
    expect(result.appId).toBe("com.my.bundleid");
  });
});

// ── rn/ios ─────────────────────────────────────────────────────────

describe("RnIosBuilder", () => {
  it("ios/Pods/ 없으면 COCOAPODS_REQUIRED 에러를 던진다", async () => {
    // ios 디렉토리만 생성 (Pods 없음)
    const iosDir = path.join(tmpDir, "ios");
    fs.mkdirSync(iosDir);
    fs.mkdirSync(path.join(iosDir, "App.xcworkspace"));

    const builder = new RnIosBuilder(path.join(tmpDir, "derived"));
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "COCOAPODS_REQUIRED" });
  });

  it("xcworkspace glob, xcodebuild 스킴 선택, derivedData .app + bundleId", async () => {
    const iosDir = path.join(tmpDir, "ios");
    fs.mkdirSync(path.join(iosDir, "Pods"), { recursive: true });
    const workspace = path.join(iosDir, "MyRNApp.xcworkspace");
    fs.mkdirSync(workspace);

    // xcodebuild -list 응답
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ workspace: { schemes: ["MyRNApp", "MyRNAppTests"] } }),
      stderr: "",
      exitCode: 0,
    });
    // xcodebuild build 응답
    mockExeca.mockResolvedValueOnce({ stdout: "** BUILD SUCCEEDED **", stderr: "", exitCode: 0 });

    const derivedDataPath = path.join(tmpDir, "rn-derived");
    const appPath = path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "MyRNApp.app");
    fs.mkdirSync(appPath, { recursive: true });
    fs.writeFileSync(
      path.join(appPath, "Info.plist"),
      `<plist><dict><key>CFBundleIdentifier</key><string>com.example.rnios</string></dict></plist>`
    );

    const builder = new RnIosBuilder(derivedDataPath);
    const result = await builder.build(tmpDir);

    // xcodebuild -workspace 인자 확인
    expect(mockExeca).toHaveBeenNthCalledWith(
      1,
      "xcodebuild",
      expect.arrayContaining(["-workspace", workspace, "-list", "-json"]),
      expect.any(Object)
    );
    // 스킴 선택: Tests 접미사 제외 → MyRNApp 선택
    expect(mockExeca).toHaveBeenNthCalledWith(
      2,
      "xcodebuild",
      expect.arrayContaining(["-scheme", "MyRNApp", "-sdk", "iphonesimulator"]),
      expect.any(Object)
    );
    expect(result.artifactPath).toBe(appPath);
    expect(result.appId).toBe("com.example.rnios");
  });

  it("BUILD_FAILED 에러를 던진다", async () => {
    const iosDir = path.join(tmpDir, "ios");
    fs.mkdirSync(path.join(iosDir, "Pods"), { recursive: true });
    fs.mkdirSync(path.join(iosDir, "App.xcworkspace"));

    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ workspace: { schemes: ["App"] } }),
      stderr: "",
      exitCode: 0,
    });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "xcodebuild failed", exitCode: 1 });

    const builder = new RnIosBuilder(path.join(tmpDir, "rn-derived"));
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "BUILD_FAILED" });
  });
});

// ── android native ─────────────────────────────────────────────────

describe("AndroidNativeBuilder", () => {
  it("settings.gradle 모듈 탐지 후 :<module>:assembleDebug --no-daemon 호출", async () => {
    const settings = `include ':app', ':lib'\n`;
    fs.writeFileSync(path.join(tmpDir, "settings.gradle"), settings);

    const gradlew = path.join(tmpDir, "gradlew");
    fs.writeFileSync(gradlew, "#!/bin/sh");

    const apkDir = path.join(tmpDir, "app", "build", "outputs", "apk", "debug");
    fs.mkdirSync(apkDir, { recursive: true });
    fs.writeFileSync(path.join(apkDir, "app-debug.apk"), "fake");

    fs.writeFileSync(
      path.join(tmpDir, "app", "build.gradle"),
      'applicationId "com.example.native"'
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new AndroidNativeBuilder();
    const result = await builder.build(tmpDir);

    expect(mockExeca).toHaveBeenCalledWith(
      expect.stringContaining("gradlew"),
      expect.arrayContaining([":app:assembleDebug", "--no-daemon"]),
      expect.any(Object)
    );
    expect(result.appId).toBe("com.example.native");
  });

  it("ANDROID_HOME / ANDROID_SDK_ROOT env 주입 (sdk 경로가 있을 때)", async () => {
    const { detectAndroidSdkPath } = await import("@karax/doctor");
    vi.mocked(detectAndroidSdkPath).mockResolvedValueOnce("/custom/sdk");

    const gradlew = path.join(tmpDir, "gradlew");
    fs.writeFileSync(gradlew, "#!/bin/sh");

    const apkDir = path.join(tmpDir, "app", "build", "outputs", "apk", "debug");
    fs.mkdirSync(apkDir, { recursive: true });
    fs.writeFileSync(path.join(apkDir, "app-debug.apk"), "fake");

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new AndroidNativeBuilder();
    await builder.build(tmpDir);

    const callArgs = mockExeca.mock.calls[0]!;
    const envArg = callArgs[2] as { env?: Record<string, string> };
    expect(envArg.env?.["ANDROID_HOME"]).toBe("/custom/sdk");
    expect(envArg.env?.["ANDROID_SDK_ROOT"]).toBe("/custom/sdk");
  });

  it("BUILD_FAILED 에러를 던진다", async () => {
    const gradlew = path.join(tmpDir, "gradlew");
    fs.writeFileSync(gradlew, "#!/bin/sh");

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "build error", exitCode: 1 });

    const builder = new AndroidNativeBuilder();
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "BUILD_FAILED" });
  });

  it("ARTIFACT_NOT_FOUND — APK 없으면 에러", async () => {
    const gradlew = path.join(tmpDir, "gradlew");
    fs.writeFileSync(gradlew, "#!/bin/sh");

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    // APK 없음

    const builder = new AndroidNativeBuilder();
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });
});

// ── iOS buildCommand: KARAX_DERIVED_DATA_PATH 주입 + fallback ──────

describe("IosNativeBuilder — buildCommand", () => {
  it("buildCommand 실행 시 KARAX_DERIVED_DATA_PATH env가 주입된다", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "App.xcworkspace"));

    const derivedDataPath = path.join(tmpDir, "custom-derived");
    const appPath = path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "App.app");
    fs.mkdirSync(appPath, { recursive: true });
    fs.writeFileSync(
      path.join(appPath, "Info.plist"),
      `<plist><dict><key>CFBundleIdentifier</key><string>com.test.ios</string></dict></plist>`
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new IosNativeBuilder(derivedDataPath);
    await builder.build(tmpDir, { buildCommand: 'xcodebuild -derivedDataPath "$KARAX_DERIVED_DATA_PATH" build' });

    const callArgs = mockExeca.mock.calls[0]!;
    const opts = callArgs[2] as { env?: Record<string, string>; shell?: boolean };
    expect(opts.env?.["KARAX_DERIVED_DATA_PATH"]).toBe(derivedDataPath);
    expect(opts.shell).toBe(true);
  });

  it("buildCommand 시 derivedDataPath fallback: findDerivedDataApp 성공", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "App.xcworkspace"));

    const derivedDataPath = path.join(tmpDir, "ios-derived");
    const appPath = path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "App.app");
    fs.mkdirSync(appPath, { recursive: true });
    fs.writeFileSync(
      path.join(appPath, "Info.plist"),
      `<plist><dict><key>CFBundleIdentifier</key><string>com.test.derived</string></dict></plist>`
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new IosNativeBuilder(derivedDataPath);
    const result = await builder.build(tmpDir, { buildCommand: "custom-build.sh" });

    expect(result.appId).toBe("com.test.derived");
    expect(result.artifactPath).toBe(appPath);
  });

  it("buildCommand 시 derivedDataPath fallback 실패 → projectPath 하위 탐색 성공", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "App.xcworkspace"));

    // derivedDataPath에는 .app 없음
    const derivedDataPath = path.join(tmpDir, "empty-derived");
    fs.mkdirSync(derivedDataPath, { recursive: true });

    // projectPath/build/ios/iphonesimulator에 .app 배치
    const simApp = path.join(tmpDir, "build", "ios", "iphonesimulator", "Runner.app");
    fs.mkdirSync(simApp, { recursive: true });
    fs.writeFileSync(
      path.join(simApp, "Info.plist"),
      `<plist><dict><key>CFBundleIdentifier</key><string>com.test.sim</string></dict></plist>`
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new IosNativeBuilder(derivedDataPath);
    const result = await builder.build(tmpDir, { buildCommand: "custom-build.sh" });

    expect(result.appId).toBe("com.test.sim");
    expect(result.artifactPath).toBe(simApp);
  });

  it("buildCommand 시 모든 경로 탐색 실패 → ARTIFACT_NOT_FOUND (안내 메시지 포함)", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "App.xcworkspace"));

    const derivedDataPath = path.join(tmpDir, "no-app-derived");
    fs.mkdirSync(derivedDataPath, { recursive: true });

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new IosNativeBuilder(derivedDataPath);
    const err = await builder
      .build(tmpDir, { buildCommand: "custom-build.sh" })
      .catch((e: unknown) => e as { code: string; message: string });

    expect(err.code).toBe("ARTIFACT_NOT_FOUND");
    expect(err.message).toMatch(/KARAX_DERIVED_DATA_PATH/);
  });

  it("buildCommand 실패 시 '사용자 빌드 커맨드 실패' 메시지를 포함한다", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "App.xcworkspace"));

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "custom build error", exitCode: 1 });

    const builder = new IosNativeBuilder(path.join(tmpDir, "derived"));
    const err = await builder
      .build(tmpDir, { buildCommand: "custom-build.sh" })
      .catch((e: unknown) => e as { code: string; message: string });

    expect(err.code).toBe("BUILD_FAILED");
    expect(err.message).toMatch(/사용자 빌드 커맨드 실패/);
  });
});

describe("RnIosBuilder — buildCommand", () => {
  it("buildCommand 실행 시 KARAX_DERIVED_DATA_PATH env가 주입된다", async () => {
    const derivedDataPath = path.join(tmpDir, "rn-custom-derived");
    const appPath = path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "RNApp.app");
    fs.mkdirSync(appPath, { recursive: true });
    fs.writeFileSync(
      path.join(appPath, "Info.plist"),
      `<plist><dict><key>CFBundleIdentifier</key><string>com.test.rn</string></dict></plist>`
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new RnIosBuilder(derivedDataPath);
    await builder.build(tmpDir, { buildCommand: "custom-rn-build.sh" });

    const callArgs = mockExeca.mock.calls[0]!;
    const opts = callArgs[2] as { env?: Record<string, string>; shell?: boolean };
    expect(opts.env?.["KARAX_DERIVED_DATA_PATH"]).toBe(derivedDataPath);
    expect(opts.shell).toBe(true);
  });

  it("buildCommand 시 derivedDataPath fallback 실패 → ios/build 탐색 성공", async () => {
    const derivedDataPath = path.join(tmpDir, "rn-empty-derived");
    fs.mkdirSync(derivedDataPath, { recursive: true });

    // ios/build/Build/Products 경로에 .app 배치
    const iosBuildApp = path.join(tmpDir, "ios", "build", "Build", "Products", "Debug-iphonesimulator", "App.app");
    fs.mkdirSync(iosBuildApp, { recursive: true });
    fs.writeFileSync(
      path.join(iosBuildApp, "Info.plist"),
      `<plist><dict><key>CFBundleIdentifier</key><string>com.test.rn.ios</string></dict></plist>`
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new RnIosBuilder(derivedDataPath);
    const result = await builder.build(tmpDir, { buildCommand: "custom-rn-build.sh" });

    expect(result.appId).toBe("com.test.rn.ios");
  });

  it("buildCommand 실패 시 '사용자 빌드 커맨드 실패' 메시지를 포함한다", async () => {
    const derivedDataPath = path.join(tmpDir, "rn-derived-fail");
    fs.mkdirSync(derivedDataPath, { recursive: true });

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "rn build failed", exitCode: 1 });

    const builder = new RnIosBuilder(derivedDataPath);
    const err = await builder
      .build(tmpDir, { buildCommand: "bad-cmd.sh" })
      .catch((e: unknown) => e as { code: string; message: string });

    expect(err.code).toBe("BUILD_FAILED");
    expect(err.message).toMatch(/사용자 빌드 커맨드 실패/);
  });
});

// ── RnAndroidBuilder: buildCommand 실패 에러 메시지 정확화 ───────────

describe("RnAndroidBuilder — buildCommand 실패 에러 메시지", () => {
  it("buildCommand 실패 시 '사용자 빌드 커맨드 실패' 메시지를 포함한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "custom android error", exitCode: 1 });

    const builder = new RnAndroidBuilder();
    const err = await builder
      .build(tmpDir, { buildCommand: "bad-android-cmd.sh" })
      .catch((e: unknown) => e as { code: string; message: string });

    expect(err.code).toBe("BUILD_FAILED");
    expect(err.message).toMatch(/사용자 빌드 커맨드 실패/);
  });
});

// ── selectBuilder 팩토리 ────────────────────────────────────────────

describe("selectBuilder", () => {
  it.each([
    ["flutter", "android", "FlutterAndroidBuilder"],
    ["flutter", "ios", "FlutterIosBuilder"],
    ["react-native", "android", "RnAndroidBuilder"],
    ["react-native", "ios", "RnIosBuilder"],
    ["android", "android", "AndroidNativeBuilder"],
    ["ios", "ios", "IosNativeBuilder"],
  ] as const)("%s/%s → %s 인스턴스를 반환한다", (framework, platform, builderName) => {
    const builder = selectBuilder(framework, platform);
    expect(builder.constructor.name).toBe(builderName);
  });

  it("지원하지 않는 조합이면 에러를 던진다", () => {
    expect(() => selectBuilder("flutter" as any, "ios" as any)).not.toThrow(); // flutter/ios는 지원
    expect(() => selectBuilder("android" as any, "ios" as any)).toThrow();
    expect(() => selectBuilder("ios" as any, "android" as any)).toThrow();
  });
});
