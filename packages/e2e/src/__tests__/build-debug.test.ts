/**
 * build/*.ts — debug 모드 + BUILD_FAILED redact 회귀 테스트 (Phase B-4)
 *
 * 검증 항목:
 * - BUILD_FAILED 메시지의 stderr raw 보간에 시크릿이 포함되지 않는다 (보안 수정, debug 무관)
 * - ExecaError(non-zero exit) 경로에서 stdout/stderr를 catch로 추출한다
 * - debug=on 시 build-<platform>.log가 생성된다
 * - debug=off 시 build log 미생성
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
import { RnAndroidBuilder } from "../build/reactNative.js";
import { AndroidNativeBuilder } from "../build/androidNative.js";
import { IosNativeBuilder } from "../build/iosNative.js";

const mockExeca = vi.mocked(execa);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-build-debug-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── BUILD_FAILED redact 보안 수정 (debug 무관 상시) ──────────────────────

describe("FlutterAndroidBuilder — BUILD_FAILED redact (보안 수정)", () => {
  it("빌드 실패 시 E2eError message에 sk- 토큰이 포함되지 않는다", async () => {
    // execa가 non-zero exit → 기존 구현은 result.stderr를 보간했음
    // 수정 후: redactSecrets로 감싸야 한다
    mockExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "flutter build failed: ANTHROPIC_API_KEY=sk-ant-api03-realkey123 not accepted",
      exitCode: 1,
    });

    const builder = new FlutterAndroidBuilder();
    try {
      await builder.build(tmpDir);
      expect.fail("BUILD_FAILED 에러가 발생해야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      const err = e as E2eError;
      expect(err.code).toBe("BUILD_FAILED");
      // API 키가 E2eError message에 없어야 한다
      expect(err.message).not.toContain("sk-ant-api03-realkey123");
      expect(err.message).toContain("[REDACTED]");
    }
  });
});

describe("FlutterIosBuilder — BUILD_FAILED redact", () => {
  it("빌드 실패 시 E2eError message에 sk- 토큰이 포함되지 않는다", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "flutter ios build error: API_KEY=sk-ant-api03-secrettoken failed",
      exitCode: 1,
    });

    const builder = new FlutterIosBuilder();
    try {
      await builder.build(tmpDir);
      expect.fail("BUILD_FAILED 에러가 발생해야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      const err = e as E2eError;
      expect(err.message).not.toContain("sk-ant-api03-secrettoken");
      expect(err.message).toContain("[REDACTED]");
    }
  });
});

describe("RnAndroidBuilder — BUILD_FAILED redact", () => {
  it("gradlew 없으면 BUILD_FAILED (기존 동작 불변)", async () => {
    // gradlew 없음
    const builder = new RnAndroidBuilder();
    await expect(builder.build(tmpDir)).rejects.toMatchObject({ code: "BUILD_FAILED" });
  });

  it("빌드 실패 시 E2eError message에 sk- 토큰이 포함되지 않는다", async () => {
    const gradlew = path.join(tmpDir, "android", "gradlew");
    fs.mkdirSync(path.dirname(gradlew), { recursive: true });
    fs.writeFileSync(gradlew, "#!/bin/sh");

    mockExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "Gradle error: GITHUB_TOKEN=ghp_abcdefghijklmn1234567890 not found",
      exitCode: 1,
    });

    const builder = new RnAndroidBuilder();
    try {
      await builder.build(tmpDir);
      expect.fail("BUILD_FAILED 에러가 발생해야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      const err = e as E2eError;
      expect(err.message).not.toContain("ghp_abcdefghijklmn1234567890");
      expect(err.message).toContain("[REDACTED]");
    }
  });
});

describe("AndroidNativeBuilder — BUILD_FAILED redact", () => {
  it("빌드 실패 시 E2eError message에 sk- 토큰이 포함되지 않는다", async () => {
    const gradlew = path.join(tmpDir, "gradlew");
    fs.writeFileSync(gradlew, "#!/bin/sh");

    mockExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "Gradle assembleDebug failed: API_SECRET=super-secret-value error",
      exitCode: 1,
    });

    const builder = new AndroidNativeBuilder();
    try {
      await builder.build(tmpDir);
      expect.fail("BUILD_FAILED 에러가 발생해야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      const err = e as E2eError;
      expect(err.message).not.toContain("super-secret-value");
      // _SECRET= 패턴이 redact됨
      expect(err.message).toContain("[REDACTED]");
    }
  });
});

// ── ExecaError 경로: non-zero exit 시 catch에서 추출 ─────────────────────

describe("FlutterAndroidBuilder — ExecaError(throw) 경로에서 build log 보존", () => {
  it("debug=on 시 execa throw 경로에서도 build-flutter-android.log가 생성된다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });

    // execa가 ExecaError를 throw (non-zero exit)
    const execaError = Object.assign(new Error("Command failed with exit code 1"), {
      exitCode: 1,
      stdout: "some build output",
      stderr: "ANTHROPIC_API_KEY=sk-ant-secret failed to compile",
    });
    mockExeca.mockRejectedValueOnce(execaError);

    const builder = new FlutterAndroidBuilder();
    try {
      await builder.build(tmpDir, { debug: true, debugDir });
    } catch (e) {
      // BUILD_FAILED 에러 예상
      expect(e).toBeInstanceOf(E2eError);
    }

    // build log가 생성되어야 한다
    const logPath = path.join(debugDir, "build-flutter-android.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    // stdout/stderr가 포함되어야 하지만 redact됨
    expect(content).not.toContain("sk-ant-secret");
    expect(content).toContain("[REDACTED]");
  });

  it("debug=off 시 build log가 생성되지 않는다", async () => {
    const execaError = Object.assign(new Error("Command failed"), {
      exitCode: 1,
      stdout: "",
      stderr: "build error",
    });
    mockExeca.mockRejectedValueOnce(execaError);

    const builder = new FlutterAndroidBuilder();
    try {
      await builder.build(tmpDir); // debug 옵션 없음
    } catch (e) {
      // BUILD_FAILED 에러 예상
    }

    // build log 미생성
    const potentialLog = path.join(tmpDir, "debug", "build-flutter-android.log");
    expect(fs.existsSync(potentialLog)).toBe(false);
  });

  it("성공 케이스에서도 debug=on 시 build log가 생성된다", async () => {
    const apkPath = path.join(tmpDir, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
    fs.mkdirSync(path.dirname(apkPath), { recursive: true });
    fs.writeFileSync(apkPath, "fake-apk");

    const gradlePath = path.join(tmpDir, "android", "app", "build.gradle");
    fs.mkdirSync(path.dirname(gradlePath), { recursive: true });
    fs.writeFileSync(gradlePath, 'applicationId "com.example.flutter"');

    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });

    mockExeca.mockResolvedValueOnce({ stdout: "Build succeeded", stderr: "", exitCode: 0 });

    const builder = new FlutterAndroidBuilder();
    const result = await builder.build(tmpDir, { debug: true, debugDir });

    expect(result.appId).toBe("com.example.flutter");
    const logPath = path.join(debugDir, "build-flutter-android.log");
    expect(fs.existsSync(logPath)).toBe(true);
  });
});

describe("IosNativeBuilder — ExecaError 경로 build log", () => {
  it("debug=on 시 xcodebuild 실패에서 build-ios-native.log가 생성된다", async () => {
    fs.mkdirSync(path.join(tmpDir, "Pods"), { recursive: true });
    const workspace = path.join(tmpDir, "App.xcworkspace");
    fs.mkdirSync(workspace);

    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });

    // xcodebuild -list 성공
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ workspace: { schemes: ["App"] } }),
      stderr: "",
      exitCode: 0,
    });
    // xcodebuild build ExecaError throw
    const execaError = Object.assign(new Error("Command failed with exit code 1"), {
      exitCode: 1,
      stdout: "xcodebuild output",
      stderr: "xcodebuild error: ANTHROPIC_API_KEY=sk-ant-xcode-secret failed",
    });
    mockExeca.mockRejectedValueOnce(execaError);

    const builder = new IosNativeBuilder(path.join(tmpDir, "derived"));
    try {
      await builder.build(tmpDir, { debug: true, debugDir });
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
    }

    const logPath = path.join(debugDir, "build-ios-native.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).not.toContain("sk-ant-xcode-secret");
    expect(content).toContain("[REDACTED]");
  });
});
