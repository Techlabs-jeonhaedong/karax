/**
 * build/artifact.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  extractAndroidAppId,
  extractIosBundleId,
  findApk,
  findFlutterApk,
  findFlutterIosApp,
  findDerivedDataApp,
} from "../build/artifact.js";

// ── extractAndroidAppId ───────────────────────────────────────────

describe("extractAndroidAppId", () => {
  it("applicationId를 파싱한다 (큰따옴표)", () => {
    const content = `android {\n  defaultConfig {\n    applicationId "com.example.myapp"\n  }\n}`;
    expect(extractAndroidAppId(content)).toBe("com.example.myapp");
  });

  it("applicationId를 파싱한다 (작은따옴표)", () => {
    const content = `applicationId 'com.example.app'`;
    expect(extractAndroidAppId(content)).toBe("com.example.app");
  });

  it("Kotlin DSL 형식도 지원", () => {
    const content = `applicationId = "com.example.kts"`;
    expect(extractAndroidAppId(content)).toBe("com.example.kts");
  });

  it("applicationId 없으면 null 반환", () => {
    expect(extractAndroidAppId("compileSdk = 34")).toBeNull();
  });

  it("빈 문자열이면 null 반환", () => {
    expect(extractAndroidAppId("")).toBeNull();
  });
});

// ── extractIosBundleId ─────────────────────────────────────────────

describe("extractIosBundleId", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Info.plist에서 CFBundleIdentifier를 파싱한다", () => {
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.iosapp</string>
</dict>
</plist>`;
    const plistPath = path.join(tmpDir, "Info.plist");
    fs.writeFileSync(plistPath, plistContent);

    const result = extractIosBundleId(plistContent);
    expect(result).toBe("com.example.iosapp");
  });

  it("CFBundleIdentifier 없으면 null 반환", () => {
    const plistContent = `<plist version="1.0"><dict></dict></plist>`;
    expect(extractIosBundleId(plistContent)).toBeNull();
  });

  it("빈 문자열이면 null 반환", () => {
    expect(extractIosBundleId("")).toBeNull();
  });

  it("$(PRODUCT_BUNDLE_IDENTIFIER) 같은 변수 치환 전 값도 반환한다", () => {
    const content = `<key>CFBundleIdentifier</key>\n<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>`;
    const result = extractIosBundleId(content);
    // 변수 형태라도 일단 값을 반환
    expect(result).toBe("$(PRODUCT_BUNDLE_IDENTIFIER)");
  });
});

// ── 경로 해석 함수 테스트 ──────────────────────────────────────────────────

describe("findApk", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-findapk-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("우선순위 경로(app/build/outputs/apk/debug)에서 APK를 반환한다", () => {
    const apkDir = path.join(tmpDir, "app", "build", "outputs", "apk", "debug");
    fs.mkdirSync(apkDir, { recursive: true });
    fs.writeFileSync(path.join(apkDir, "app-debug.apk"), "fake");

    expect(findApk(tmpDir)).toBe(path.join(apkDir, "app-debug.apk"));
  });

  it("우선순위 경로가 없으면 build 재귀에서 최신 mtime APK를 반환한다", () => {
    const buildDir = path.join(tmpDir, "app", "build", "nested");
    fs.mkdirSync(buildDir, { recursive: true });

    const older = path.join(buildDir, "old.apk");
    const newer = path.join(buildDir, "new.apk");
    fs.writeFileSync(older, "old");
    // 1초 후 newer 파일 생성 — mtime 차이를 만든다
    const now = Date.now();
    fs.writeFileSync(newer, "new");
    fs.utimesSync(older, new Date(now - 2000), new Date(now - 2000));
    fs.utimesSync(newer, new Date(now), new Date(now));

    const result = findApk(tmpDir);
    expect(result).toBe(newer);
  });

  it("APK가 없으면 null 반환", () => {
    expect(findApk(tmpDir)).toBeNull();
  });
});

describe("findFlutterApk", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-flutterapk-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("기대 경로(build/app/outputs/flutter-apk/app-debug.apk)가 있으면 그것을 반환한다", () => {
    const expected = path.join(tmpDir, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
    fs.mkdirSync(path.dirname(expected), { recursive: true });
    fs.writeFileSync(expected, "fake");

    expect(findFlutterApk(tmpDir)).toBe(expected);
  });

  it("기대 경로 없으면 build/app/outputs 아래 최신 mtime APK를 반환한다", () => {
    const outputsDir = path.join(tmpDir, "build", "app", "outputs", "profile");
    fs.mkdirSync(outputsDir, { recursive: true });

    const apk = path.join(outputsDir, "app-profile.apk");
    fs.writeFileSync(apk, "fake");

    expect(findFlutterApk(tmpDir)).toBe(apk);
  });

  it("APK가 없으면 null 반환", () => {
    expect(findFlutterApk(tmpDir)).toBeNull();
  });
});

describe("findFlutterIosApp", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-flutterios-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("build/ios/iphonesimulator 에서 단일 .app 반환", () => {
    const appDir = path.join(tmpDir, "build", "ios", "iphonesimulator", "Runner.app");
    fs.mkdirSync(appDir, { recursive: true });

    expect(findFlutterIosApp(tmpDir)).toBe(appDir);
  });

  it("여러 .app 후보 중 최신 mtime 반환", () => {
    const simDir = path.join(tmpDir, "build", "ios", "iphonesimulator");
    fs.mkdirSync(simDir, { recursive: true });

    const older = path.join(simDir, "OldApp.app");
    const newer = path.join(simDir, "NewApp.app");
    fs.mkdirSync(older);
    fs.mkdirSync(newer);

    const now = Date.now();
    fs.utimesSync(older, new Date(now - 2000), new Date(now - 2000));
    fs.utimesSync(newer, new Date(now), new Date(now));

    expect(findFlutterIosApp(tmpDir)).toBe(newer);
  });

  it("iphonesimulator 디렉토리 없으면 null 반환", () => {
    expect(findFlutterIosApp(tmpDir)).toBeNull();
  });
});

describe("findDerivedDataApp", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-derived-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Build/Products 아래 단일 .app 반환", () => {
    const appDir = path.join(tmpDir, "Build", "Products", "Debug-iphonesimulator", "MyApp.app");
    fs.mkdirSync(appDir, { recursive: true });

    expect(findDerivedDataApp(tmpDir)).toBe(appDir);
  });

  it("여러 .app 후보 중 최신 mtime 반환", () => {
    const productsDir = path.join(tmpDir, "Build", "Products");
    const debugDir = path.join(productsDir, "Debug-iphonesimulator");
    const releaseDir = path.join(productsDir, "Release-iphonesimulator");
    fs.mkdirSync(debugDir, { recursive: true });
    fs.mkdirSync(releaseDir, { recursive: true });

    const older = path.join(debugDir, "OldBuild.app");
    const newer = path.join(releaseDir, "NewBuild.app");
    fs.mkdirSync(older);
    fs.mkdirSync(newer);

    const now = Date.now();
    fs.utimesSync(older, new Date(now - 2000), new Date(now - 2000));
    fs.utimesSync(newer, new Date(now), new Date(now));

    expect(findDerivedDataApp(tmpDir)).toBe(newer);
  });

  it("Build/Products 없으면 null 반환", () => {
    expect(findDerivedDataApp(tmpDir)).toBeNull();
  });
});
