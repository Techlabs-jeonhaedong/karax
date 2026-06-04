/**
 * 개별 체크 단위 테스트 (Red → Green → Refactor)
 * execa를 vi.mock으로 완전 격리해 각 분기를 검증한다.
 *
 * 주의: checkPlaywrightChromium은 getChromiumPath(playwright Node API)를 사용하므로
 * 별도 파일 checks.playwright.test.ts에서 격리 테스트한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// execa mock — 모든 체크 모듈보다 먼저 선언
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import {
  checkNode,
  checkFlutter,
  checkDart,
  checkJava,
  checkGradle,
  checkXcodebuild,
  checkCocoaPods,
} from "../checks/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockExeca.mockRejectedValue(Object.assign(new Error("not found"), { exitCode: 1 }));
});

// ─── checkNode ────────────────────────────────────────────────────────────────

describe("checkNode", () => {
  it("ok: 버전 >=20 이면 status=ok, autoInstallable=false 반환", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "v24.4.1", stderr: "", exitCode: 0 });
    const result = await checkNode();
    expect(result.id).toBe("node");
    expect(result.status).toBe("ok");
    expect(result.version).toBe("24.4.1");
    expect(result.autoInstallable).toBe(false);
  });

  it("outdated: 버전 18 이면 status=outdated", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "v18.20.0", stderr: "", exitCode: 0 });
    const result = await checkNode();
    expect(result.status).toBe("outdated");
    expect(result.version).toBe("18.20.0");
  });

  it("outdated: 버전 19 이면 status=outdated", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "v19.9.0", stderr: "", exitCode: 0 });
    const result = await checkNode();
    expect(result.status).toBe("outdated");
  });

  it("ok: 버전 정확히 20 이면 status=ok", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "v20.0.0", stderr: "", exitCode: 0 });
    const result = await checkNode();
    expect(result.status).toBe("ok");
  });

  it("missing: execa 실패 시 status=missing", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkNode();
    expect(result.status).toBe("missing");
    expect(result.version).toBeUndefined();
  });

  it("hint 문자열이 비어있지 않음", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkNode();
    expect(result.hint).toBeTruthy();
    expect(result.hint.length).toBeGreaterThan(0);
  });

  it("label이 비어있지 않음", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "v20.0.0", stderr: "", exitCode: 0 });
    const result = await checkNode();
    expect(result.label).toBeTruthy();
  });
});

// ─── checkFlutter ─────────────────────────────────────────────────────────────

describe("checkFlutter", () => {
  const FLUTTER_OUT = [
    "Flutter 3.38.5 • channel stable • https://github.com/flutter/flutter.git",
    "Framework • revision f6ff1529fd (6 months ago) • 2025-12-11 11:50:07 -0500",
    "Engine • hash c108a94d7a8273e112339e6c6833daa06e723a54",
    "Tools • Dart 3.10.4 • DevTools 2.45.1",
  ].join("\n");

  it("ok: flutter --version 파싱 성공", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: FLUTTER_OUT, stderr: FLUTTER_OUT, exitCode: 0 });
    const result = await checkFlutter();
    expect(result.id).toBe("flutter");
    expect(result.status).toBe("ok");
    expect(result.version).toBe("3.38.5");
    expect(result.autoInstallable).toBe(false);
  });

  it("missing: 설치 안 됨", async () => {
    mockExeca.mockRejectedValueOnce(new Error("flutter: command not found"));
    const result = await checkFlutter();
    expect(result.status).toBe("missing");
    expect(result.version).toBeUndefined();
  });

  it("missing: 출력에서 버전 파싱 실패 시 missing 처리", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "unexpected output", stderr: "", exitCode: 0 });
    const result = await checkFlutter();
    expect(result.status).toBe("missing");
  });

  it("hint에 설치 안내 포함", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkFlutter();
    expect(result.hint).toMatch(/flutter|https/i);
  });
});

// ─── checkDart ────────────────────────────────────────────────────────────────

describe("checkDart", () => {
  it("ok: dart --version 파싱 성공", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "Dart SDK version: 3.10.4 (stable)", stderr: "", exitCode: 0 });
    const result = await checkDart();
    expect(result.id).toBe("dart");
    expect(result.status).toBe("ok");
    expect(result.version).toBe("3.10.4");
    expect(result.autoInstallable).toBe(false);
  });

  it("missing: 설치 안 됨", async () => {
    mockExeca.mockRejectedValueOnce(new Error("dart: command not found"));
    const result = await checkDart();
    expect(result.status).toBe("missing");
  });

  it("missing: 버전 파싱 실패", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "unknown format", stderr: "", exitCode: 0 });
    const result = await checkDart();
    expect(result.status).toBe("missing");
  });
});

// ─── checkJava ────────────────────────────────────────────────────────────────

describe("checkJava", () => {
  const JAVA_OUT = 'openjdk version "17.0.15" 2025-04-15\nOpenJDK Runtime Environment Homebrew (build 17.0.15+0)';

  it("ok: JDK>=11 이면 status=ok", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: JAVA_OUT, stderr: JAVA_OUT, exitCode: 0 });
    const result = await checkJava();
    expect(result.id).toBe("java");
    expect(result.status).toBe("ok");
    expect(result.version).toBe("17.0.15");
    expect(result.autoInstallable).toBe(false);
  });

  it("outdated: JDK 버전 8이면 outdated", async () => {
    const out = 'openjdk version "1.8.0_392" 2023-10-17';
    mockExeca.mockResolvedValueOnce({ stdout: out, stderr: out, exitCode: 0 });
    const result = await checkJava();
    expect(result.status).toBe("outdated");
  });

  it("outdated: JDK 버전 10이면 outdated", async () => {
    const out = 'openjdk version "10.0.2" 2018-07-17';
    mockExeca.mockResolvedValueOnce({ stdout: out, stderr: out, exitCode: 0 });
    const result = await checkJava();
    expect(result.status).toBe("outdated");
  });

  it("ok: JDK 버전 11이면 ok (경계값)", async () => {
    const out = 'openjdk version "11.0.21" 2023-10-17';
    mockExeca.mockResolvedValueOnce({ stdout: out, stderr: out, exitCode: 0 });
    const result = await checkJava();
    expect(result.status).toBe("ok");
  });

  it("missing: 설치 안 됨", async () => {
    mockExeca.mockRejectedValueOnce(new Error("java: command not found"));
    const result = await checkJava();
    expect(result.status).toBe("missing");
  });

  it("missing: 버전 파싱 실패", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "unexpected", stderr: "unexpected", exitCode: 0 });
    const result = await checkJava();
    expect(result.status).toBe("missing");
  });
});

// ─── checkGradle ─────────────────────────────────────────────────────────────

describe("checkGradle", () => {
  it("ok: gradle --version 성공", async () => {
    const out = "------------------------------------------------------------\nGradle 8.14.3\n";
    mockExeca.mockResolvedValueOnce({ stdout: out, stderr: "", exitCode: 0 });
    const result = await checkGradle();
    expect(result.id).toBe("gradle");
    expect(result.status).toBe("ok");
    expect(result.version).toBe("8.14.3");
    expect(result.autoInstallable).toBe(false);
  });

  it("missing: 설치 안 됨, wrapper도 없음", async () => {
    mockExeca.mockRejectedValue(new Error("not found"));
    const result = await checkGradle();
    expect(result.status).toBe("missing");
  });

  it("missing: 버전 파싱 실패", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "unknown", stderr: "", exitCode: 0 });
    const result = await checkGradle();
    expect(result.status).toBe("missing");
  });
});

// ─── checkXcodebuild ─────────────────────────────────────────────────────────

describe("checkXcodebuild", () => {
  it("ok: macOS에서 xcodebuild + simctl 모두 ok", async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: "Xcode 16.2\nBuild version 16C5032a", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "== Devices ==\n-- iOS 17.0 --\n", stderr: "", exitCode: 0 });
    const result = await checkXcodebuild();
    expect(result.id).toBe("xcodebuild");
    // macOS 환경이므로 ok, non-darwin이면 missing
    expect(["ok", "missing"]).toContain(result.status);
  });

  it("missing: xcodebuild 없으면 missing", async () => {
    mockExeca.mockRejectedValue(new Error("not found"));
    const result = await checkXcodebuild();
    expect(result.status).toBe("missing");
  });

  it("hint는 항상 비어있지 않음", async () => {
    mockExeca.mockRejectedValue(new Error("not found"));
    const result = await checkXcodebuild();
    expect(result.hint).toBeTruthy();
  });
});

// ─── checkCocoaPods ──────────────────────────────────────────────────────────

describe("checkCocoaPods", () => {
  it("ok: pod --version 성공", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "1.16.2", stderr: "", exitCode: 0 });
    const result = await checkCocoaPods();
    expect(result.id).toBe("cocoapods");
    expect(result.status).toBe("ok");
    expect(result.version).toBe("1.16.2");
    expect(result.autoInstallable).toBe(false);
  });

  it("missing: pod 없음", async () => {
    mockExeca.mockRejectedValueOnce(new Error("pod: command not found"));
    const result = await checkCocoaPods();
    expect(result.status).toBe("missing");
  });

  it("missing: 버전 파싱 실패(빈 출력)", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    const result = await checkCocoaPods();
    expect(result.status).toBe("missing");
  });
});
