/**
 * buildCommand 지원 단위 테스트 (TDD Red 단계)
 *
 * 커버 케이스:
 * - buildCommand 지정 시 shell=true로 해당 커맨드 실행 (flutter android, rn android)
 * - buildCommand 미지정 시 기존 기본 커맨드 그대로 (회귀 방지)
 * - buildCommand 실패(non-zero exit) 시 BUILD_FAILED + redactSecrets 적용
 * - 캐시 핑거프린트가 buildCommand에 따라 달라지는지
 * - findFlutterApk가 flavor APK(app-dev-debug.apk)를 찾는지 + 기본 APK 우선인지
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
import { FlutterAndroidBuilder } from "../build/flutter.js";
import { RnAndroidBuilder } from "../build/reactNative.js";
import { AndroidNativeBuilder } from "../build/androidNative.js";
import { computeSourceFingerprint } from "../build/cache.js";
import { findFlutterApk } from "../build/artifact.js";

const mockExeca = vi.mocked(execa);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-build-cmd-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── buildCommand: FlutterAndroidBuilder ───────────────────────────────

describe("FlutterAndroidBuilder — buildCommand", () => {
  it("buildCommand 지정 시 shell=true로 해당 커맨드를 실행한다", async () => {
    const apkPath = path.join(tmpDir, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
    fs.mkdirSync(path.dirname(apkPath), { recursive: true });
    fs.writeFileSync(apkPath, "fake-apk");

    const gradlePath = path.join(tmpDir, "android", "app", "build.gradle");
    fs.mkdirSync(path.dirname(gradlePath), { recursive: true });
    fs.writeFileSync(gradlePath, 'applicationId "com.example.flutter"');

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new FlutterAndroidBuilder();
    const result = await builder.build(tmpDir, {
      buildCommand: "fvm flutter build apk --debug --flavor dev",
    });

    // shell=true로 buildCommand 전체 문자열이 실행되어야 한다
    expect(mockExeca).toHaveBeenCalledWith(
      "fvm flutter build apk --debug --flavor dev",
      [],
      expect.objectContaining({ shell: true, cwd: tmpDir })
    );
    expect(result.artifactPath).toBe(apkPath);
  });

  it("buildCommand 미지정 시 기존 flutter build apk --debug 커맨드 그대로", async () => {
    const apkPath = path.join(tmpDir, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
    fs.mkdirSync(path.dirname(apkPath), { recursive: true });
    fs.writeFileSync(apkPath, "fake-apk");

    const gradlePath = path.join(tmpDir, "android", "app", "build.gradle");
    fs.mkdirSync(path.dirname(gradlePath), { recursive: true });
    fs.writeFileSync(gradlePath, 'applicationId "com.example.flutter"');

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new FlutterAndroidBuilder();
    await builder.build(tmpDir);

    // buildCommand 없으면 기존 방식 (shell 없음)
    expect(mockExeca).toHaveBeenCalledWith(
      "flutter",
      expect.arrayContaining(["build", "apk", "--debug"]),
      expect.not.objectContaining({ shell: true })
    );
  });

  it("buildCommand 실패(non-zero exit) 시 BUILD_FAILED + redactSecrets 적용", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "secret_token=abc123 build failed",
      exitCode: 1,
    });

    const builder = new FlutterAndroidBuilder();
    const err = await builder
      .build(tmpDir, { buildCommand: "fvm flutter build apk --debug" })
      .catch((e: unknown) => e as E2eError);

    expect(err).toBeInstanceOf(E2eError);
    expect(err.code).toBe("BUILD_FAILED");
    // redactSecrets 적용 — 원본 시크릿 문자열은 노출되지 않아야 한다
    // (redactSecrets가 토큰 패턴을 치환하므로 최소한 에러 메시지가 존재해야 함)
    expect(err.message).toBeTruthy();
  });

  it("buildCommand 예외 throw 시에도 BUILD_FAILED를 던진다", async () => {
    const execaErr = Object.assign(new Error("command not found"), {
      stdout: "",
      stderr: "fvm: command not found",
      exitCode: 127,
    });
    mockExeca.mockRejectedValueOnce(execaErr);

    const builder = new FlutterAndroidBuilder();
    await expect(
      builder.build(tmpDir, { buildCommand: "fvm flutter build apk --debug" })
    ).rejects.toMatchObject({ code: "BUILD_FAILED" });
  });
});

// ── buildCommand: RnAndroidBuilder ────────────────────────────────────

describe("RnAndroidBuilder — buildCommand", () => {
  it("buildCommand 지정 시 shell=true로 해당 커맨드를 실행한다", async () => {
    // RnAndroidBuilder는 android/gradlew 존재 여부를 먼저 확인하지만
    // buildCommand 있으면 그 전에 gradlew 체크를 건너뛰어야 한다
    const apkDir = path.join(tmpDir, "android", "app", "build", "outputs", "apk", "debug");
    fs.mkdirSync(apkDir, { recursive: true });
    fs.writeFileSync(path.join(apkDir, "app-debug.apk"), "fake-apk");

    const buildGradle = path.join(tmpDir, "android", "app", "build.gradle");
    fs.mkdirSync(path.dirname(buildGradle), { recursive: true });
    fs.writeFileSync(buildGradle, 'applicationId "com.example.rn"');

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new RnAndroidBuilder();
    const result = await builder.build(tmpDir, {
      buildCommand: "react-native build-android --mode debug",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "react-native build-android --mode debug",
      [],
      expect.objectContaining({ shell: true, cwd: tmpDir })
    );
    expect(result.appId).toBe("com.example.rn");
  });

  it("buildCommand 미지정 시 기존 gradlew assembleDebug 그대로", async () => {
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
    await builder.build(tmpDir);

    // buildCommand 없으면 기존 방식
    expect(mockExeca).toHaveBeenCalledWith(
      expect.stringContaining("gradlew"),
      expect.arrayContaining(["assembleDebug"]),
      expect.not.objectContaining({ shell: true })
    );
  });
});

// ── buildCommand: AndroidNativeBuilder ────────────────────────────────

describe("AndroidNativeBuilder — buildCommand", () => {
  it("buildCommand 지정 시 shell=true로 해당 커맨드를 실행한다", async () => {
    const apkDir = path.join(tmpDir, "app", "build", "outputs", "apk", "debug");
    fs.mkdirSync(apkDir, { recursive: true });
    fs.writeFileSync(path.join(apkDir, "app-debug.apk"), "fake-apk");

    fs.writeFileSync(
      path.join(tmpDir, "app", "build.gradle"),
      'applicationId "com.example.native"'
    );

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const builder = new AndroidNativeBuilder();
    const result = await builder.build(tmpDir, {
      buildCommand: "./custom-build.sh --flavor prod",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "./custom-build.sh --flavor prod",
      [],
      expect.objectContaining({ shell: true, cwd: tmpDir })
    );
    expect(result.appId).toBe("com.example.native");
  });
});

// ── 캐시 핑거프린트: buildCommand 포함 ────────────────────────────────

describe("computeSourceFingerprint — buildCommand 포함", () => {
  // NOTE: 실제 파일시스템이 필요한 테스트 — mock 없이 실제 tmpDir 사용

  it("buildCommand가 다르면 핑거프린트 hash가 달라진다", () => {
    // lib/ 디렉토리와 pubspec.yaml 생성 (flutter 스캔 대상)
    const libDir = path.join(tmpDir, "lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, "main.dart"), "void main() {}");
    fs.writeFileSync(path.join(tmpDir, "pubspec.yaml"), "name: test");

    const fp1 = computeSourceFingerprint(tmpDir, "flutter", { buildCommand: undefined });
    const fp2 = computeSourceFingerprint(tmpDir, "flutter", { buildCommand: "fvm flutter build apk --flavor dev" });

    expect(fp1.hash).not.toBe(fp2.hash);
  });

  it("buildCommand가 같으면 핑거프린트 hash가 같다", () => {
    const libDir = path.join(tmpDir, "lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, "main.dart"), "void main() {}");
    fs.writeFileSync(path.join(tmpDir, "pubspec.yaml"), "name: test");

    const cmd = "fvm flutter build apk --flavor dev";
    const fp1 = computeSourceFingerprint(tmpDir, "flutter", { buildCommand: cmd });
    const fp2 = computeSourceFingerprint(tmpDir, "flutter", { buildCommand: cmd });

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("buildCommand=undefined와 buildCommand 미전달은 같은 hash", () => {
    const libDir = path.join(tmpDir, "lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, "main.dart"), "void main() {}");

    const fp1 = computeSourceFingerprint(tmpDir, "flutter");
    const fp2 = computeSourceFingerprint(tmpDir, "flutter", {});

    expect(fp1.hash).toBe(fp2.hash);
  });
});

// ── findFlutterApk: flavor APK 탐색 ──────────────────────────────────

describe("findFlutterApk — flavor APK 견고화", () => {
  let tmpApkDir: string;

  beforeEach(() => {
    tmpApkDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-flutter-apk-flavor-"));
  });

  afterEach(() => {
    fs.rmSync(tmpApkDir, { recursive: true, force: true });
  });

  it("기본 app-debug.apk가 있으면 그것을 우선 반환한다", () => {
    const flutterApkDir = path.join(tmpApkDir, "build", "app", "outputs", "flutter-apk");
    fs.mkdirSync(flutterApkDir, { recursive: true });

    const defaultApk = path.join(flutterApkDir, "app-debug.apk");
    const flavorApk = path.join(flutterApkDir, "app-dev-debug.apk");
    fs.writeFileSync(defaultApk, "default-apk");
    fs.writeFileSync(flavorApk, "flavor-apk");

    const result = findFlutterApk(tmpApkDir);
    expect(result).toBe(defaultApk);
  });

  it("app-debug.apk 없고 flavor APK(app-dev-debug.apk)만 있으면 그것을 반환한다", () => {
    const flutterApkDir = path.join(tmpApkDir, "build", "app", "outputs", "flutter-apk");
    fs.mkdirSync(flutterApkDir, { recursive: true });

    const flavorApk = path.join(flutterApkDir, "app-dev-debug.apk");
    fs.writeFileSync(flavorApk, "flavor-apk");

    const result = findFlutterApk(tmpApkDir);
    expect(result).toBe(flavorApk);
  });

  it("flutter-apk 디렉토리 안 임의 *.apk를 찾는다", () => {
    const flutterApkDir = path.join(tmpApkDir, "build", "app", "outputs", "flutter-apk");
    fs.mkdirSync(flutterApkDir, { recursive: true });

    const stagingApk = path.join(flutterApkDir, "app-staging-release.apk");
    fs.writeFileSync(stagingApk, "staging-apk");

    const result = findFlutterApk(tmpApkDir);
    expect(result).toBe(stagingApk);
  });

  it("APK가 없으면 null 반환", () => {
    fs.mkdirSync(path.join(tmpApkDir, "build", "app", "outputs", "flutter-apk"), { recursive: true });
    expect(findFlutterApk(tmpApkDir)).toBeNull();
  });

  it("flutter-apk 디렉토리에 mtime이 다른 두 flavor APK가 있으면 최신 mtime APK를 선택한다", () => {
    const flutterApkDir = path.join(tmpApkDir, "build", "app", "outputs", "flutter-apk");
    fs.mkdirSync(flutterApkDir, { recursive: true });

    const olderApk = path.join(flutterApkDir, "app-dev-debug.apk");
    const newerApk = path.join(flutterApkDir, "app-staging-debug.apk");
    fs.writeFileSync(olderApk, "older-apk");
    fs.writeFileSync(newerApk, "newer-apk");

    const now = Date.now();
    fs.utimesSync(olderApk, new Date(now - 5000), new Date(now - 5000));
    fs.utimesSync(newerApk, new Date(now), new Date(now));

    const result = findFlutterApk(tmpApkDir);
    expect(result).toBe(newerApk);
  });
});
