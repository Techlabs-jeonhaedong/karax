/**
 * runDoctor / doctorFix 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { runDoctor, doctorFix } from "../index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

// 모든 체크가 ok를 반환하도록 광범위 mock
function setupAllOk() {
  mockExeca.mockImplementation((cmd: string, args: string[] = []) => {
    // node --version
    if (cmd === "node" && args.includes("--version")) {
      return Promise.resolve({ stdout: "v24.4.1", stderr: "", exitCode: 0 });
    }
    // playwright chromium-path
    if (args.includes("chromium-path") || args.includes("show-browsers")) {
      return Promise.resolve({ stdout: "/some/path/chrome", stderr: "", exitCode: 0 });
    }
    // flutter --version
    if (cmd === "flutter" && args.includes("--version")) {
      return Promise.resolve({
        stdout: "Flutter 3.38.5 • channel stable",
        stderr: "Flutter 3.38.5 • channel stable\nEngine • hash\nTools • Dart 3.10.4",
        exitCode: 0,
      });
    }
    // dart --version
    if (cmd === "dart" && args.includes("--version")) {
      return Promise.resolve({ stdout: "Dart SDK version: 3.10.4 (stable)", stderr: "", exitCode: 0 });
    }
    // java -version
    if (cmd === "java" && args.includes("-version")) {
      return Promise.resolve({
        stdout: 'openjdk version "17.0.15" 2025-04-15',
        stderr: 'openjdk version "17.0.15" 2025-04-15',
        exitCode: 0,
      });
    }
    // gradle --version
    if (cmd === "gradle" && args.includes("--version")) {
      return Promise.resolve({ stdout: "Gradle 8.14.3", stderr: "", exitCode: 0 });
    }
    // xcodebuild -version
    if (cmd === "xcodebuild" && args.includes("-version")) {
      return Promise.resolve({ stdout: "Xcode 16.2\nBuild version 16C5032a", stderr: "", exitCode: 0 });
    }
    // xcrun simctl
    if (cmd === "xcrun" && args.includes("simctl")) {
      return Promise.resolve({ stdout: "== Devices ==\n", stderr: "", exitCode: 0 });
    }
    // pod --version
    if (cmd === "pod" && args.includes("--version")) {
      return Promise.resolve({ stdout: "1.16.2", stderr: "", exitCode: 0 });
    }
    // adb version
    if (args.includes("version") && (cmd === "adb" || cmd.includes("adb"))) {
      return Promise.resolve({ stdout: "Android Debug Bridge version 1.0.41", stderr: "", exitCode: 0 });
    }
    // emulator -version
    if (args.includes("-version") && cmd.includes("emulator")) {
      return Promise.resolve({ stdout: "Android emulator version 34.1.9", stderr: "", exitCode: 0 });
    }
    // emulator -list-avds
    if (args.includes("-list-avds")) {
      return Promise.resolve({ stdout: "Pixel_6_API_34", stderr: "", exitCode: 0 });
    }
    // claude/codex/gemini --version
    if (args.includes("--version") && (cmd === "claude" || cmd === "codex" || cmd === "gemini")) {
      return Promise.resolve({ stdout: "1.0.0", stderr: "", exitCode: 0 });
    }
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runDoctor", () => {
  it("DoctorReport 구조를 반환함", async () => {
    setupAllOk();
    const report = await runDoctor();
    expect(report).toHaveProperty("checks");
    expect(report).toHaveProperty("tiersAvailable");
    expect(report).toHaveProperty("overallOk");
    expect(Array.isArray(report.checks)).toBe(true);
    expect(typeof report.overallOk).toBe("boolean");
  });

  it("checks 배열에 필수 id가 모두 포함됨", async () => {
    setupAllOk();
    const report = await runDoctor();
    const ids = report.checks.map((c) => c.id);
    expect(ids).toContain("node");
    expect(ids).toContain("playwright-chromium");
    expect(ids).toContain("flutter");
    expect(ids).toContain("dart");
    expect(ids).toContain("java");
    expect(ids).toContain("gradle");
    expect(ids).toContain("cocoapods");
    expect(ids).toContain("android-sdk");
  });

  it("tiersAvailable에 4개 프레임워크가 포함됨", async () => {
    setupAllOk();
    const report = await runDoctor();
    expect(report.tiersAvailable).toHaveProperty("flutter");
    expect(report.tiersAvailable).toHaveProperty("react-native");
    expect(report.tiersAvailable).toHaveProperty("android");
    expect(report.tiersAvailable).toHaveProperty("ios");
  });

  it("모든 ok 환경에서 overallOk=true", async () => {
    setupAllOk();
    const report = await runDoctor();
    expect(report.overallOk).toBe(true);
  });

  it("projectPath 인자를 받아도 정상 동작(옵셔널)", async () => {
    setupAllOk();
    const report = await runDoctor("/some/project/path");
    expect(report).toHaveProperty("checks");
  });
});

describe("doctorFix", () => {
  it("autoInstallable 항목 없으면 빠르게 재진단 반환", async () => {
    setupAllOk();
    const report = await runDoctor();
    setupAllOk();
    const fixed = await doctorFix(report);
    expect(fixed).toHaveProperty("checks");
    expect(fixed).toHaveProperty("overallOk");
  });

  it("report 없이 호출해도 동작 (내부에서 runDoctor 호출)", async () => {
    setupAllOk();
    const fixed = await doctorFix();
    expect(fixed).toHaveProperty("checks");
  });
});
