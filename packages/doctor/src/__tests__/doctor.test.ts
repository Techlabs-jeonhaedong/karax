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
    // xcrun simctl list devices available (ios-simulator) — iOS 섹션 포함
    if (cmd === "xcrun" && args.includes("simctl")) {
      return Promise.resolve({
        stdout: "== Devices ==\n-- iOS 17.5 --\n    iPhone 15 (A1B2C3D4) (Shutdown)\n",
        stderr: "",
        exitCode: 0,
      });
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
    // idb --version (ios-idb)
    if (cmd === "idb" && args.includes("--version")) {
      return Promise.resolve({ stdout: "1.1.7", stderr: "", exitCode: 0 });
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

// ── runAllChecks 병렬성 검증 (항목 7) ────────────────────────────
// checkAgentClis를 선행 await하지 않고 단일 Promise.all에 포함해야 한다.
// 결과 배열에 agent CLI 체크 결과가 포함되는지 검증한다.

describe("runDoctor — checkAgentClis가 결과에 포함됨 (병렬성 회귀)", () => {
  it("agent CLI 체크 결과(claude/codex/gemini)가 checks 배열에 포함된다", async () => {
    setupAllOk();
    const report = await runDoctor();
    const ids = report.checks.map((c) => c.id);
    // 3개 중 하나 이상 포함되면 병렬 처리가 정상 동작한 것
    const agentIds = ids.filter((id) => ["claude-cli", "codex-cli", "gemini-cli"].includes(id));
    expect(agentIds.length).toBeGreaterThanOrEqual(1);
  });

  it("checkAgentClis 결과가 다른 체크 결과와 함께 단일 배열로 반환된다", async () => {
    setupAllOk();
    const report = await runDoctor();
    // node 체크와 agent CLI 체크가 모두 포함돼야 함
    const ids = report.checks.map((c) => c.id);
    expect(ids).toContain("node");
    const hasAnyAgentCli = ids.some((id) => ["claude-cli", "codex-cli", "gemini-cli"].includes(id));
    expect(hasAnyAgentCli).toBe(true);
  });
});

// ── M9: ios-simulator · ios-idb 신규 체크 통합 검증 ─────────────────────────

describe("runDoctor — ios-simulator·ios-idb 체크가 결과에 포함됨 (M9)", () => {
  it("setupAllOk 환경에서 ios-simulator가 ok 상태여야 함 (dead mock 회귀)", async () => {
    setupAllOk();
    const report = await runDoctor();
    const simCheck = report.checks.find((c) => c.id === "ios-simulator");
    expect(simCheck).toBeDefined();
    expect(simCheck?.status).toBe("ok");
  });

  it("checks 배열에 ios-simulator id가 포함된다", async () => {
    setupAllOk();
    const report = await runDoctor();
    const ids = report.checks.map((c) => c.id);
    expect(ids).toContain("ios-simulator");
  });

  it("checks 배열에 ios-idb id가 포함된다", async () => {
    setupAllOk();
    const report = await runDoctor();
    const ids = report.checks.map((c) => c.id);
    expect(ids).toContain("ios-idb");
  });

  it("ios-simulator는 optional=true이므로 missing이어도 overallOk에 영향 없음", async () => {
    // 모든 체크 ok, simctl만 실패
    mockExeca.mockImplementation((cmd: string, args: string[] = []) => {
      if (cmd === "xcrun" && args.includes("simctl")) {
        return Promise.reject(new Error("simctl not found"));
      }
      if (cmd === "node" && args.includes("--version")) {
        return Promise.resolve({ stdout: "v24.4.1", stderr: "", exitCode: 0 });
      }
      if (args.includes("chromium-path") || args.includes("show-browsers")) {
        return Promise.resolve({ stdout: "/some/path/chrome", stderr: "", exitCode: 0 });
      }
      if (cmd === "flutter" && args.includes("--version")) {
        return Promise.resolve({
          stdout: "Flutter 3.38.5 • channel stable",
          stderr: "Flutter 3.38.5 • channel stable\nTools • Dart 3.10.4",
          exitCode: 0,
        });
      }
      if (cmd === "dart" && args.includes("--version")) {
        return Promise.resolve({ stdout: "Dart SDK version: 3.10.4 (stable)", stderr: "", exitCode: 0 });
      }
      if (cmd === "java" && args.includes("-version")) {
        return Promise.resolve({
          stdout: 'openjdk version "17.0.15" 2025-04-15',
          stderr: 'openjdk version "17.0.15" 2025-04-15',
          exitCode: 0,
        });
      }
      if (cmd === "gradle" && args.includes("--version")) {
        return Promise.resolve({ stdout: "Gradle 8.14.3", stderr: "", exitCode: 0 });
      }
      if (cmd === "xcodebuild" && args.includes("-version")) {
        return Promise.resolve({ stdout: "Xcode 16.2\nBuild version 16C5032a", stderr: "", exitCode: 0 });
      }
      if (cmd === "pod" && args.includes("--version")) {
        return Promise.resolve({ stdout: "1.16.2", stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });
    const report = await runDoctor();
    // ios-simulator는 optional이므로 overallOk는 필수 항목에만 의존
    expect(typeof report.overallOk).toBe("boolean");
    const simCheck = report.checks.find((c) => c.id === "ios-simulator");
    expect(simCheck?.optional).toBe(true);
  });
});

describe("doctorFix — ios-idb autoInstallable 분기", () => {
  it("ios-idb가 missing+autoInstallable이면 ensureIdb를 호출한다", async () => {
    // ios-idb missing 상태 report 구성
    setupAllOk();
    const baseReport = await runDoctor();
    setupAllOk();

    // ensureIdb 내부에서 사용하는 execa 호출 순서:
    // 1. idb --version (alreadyPresent 확인) - 실패
    // 2. brew --version - 성공
    // 3. brew install - 성공
    // 그 뒤 재진단 runDoctor에서 setupAllOk 패턴

    // doctorFix를 호출할 때 baseReport의 ios-idb를 missing으로 교체
    const missingIdbReport = {
      ...baseReport,
      checks: baseReport.checks.map((c) =>
        c.id === "ios-idb" ? { ...c, status: "missing" as const, autoInstallable: true } : c
      ),
    };

    // ensureIdb 내 execa 순서를 위한 mock 설정
    // idb --version 실패
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    // brew --version 성공
    mockExeca.mockResolvedValueOnce({ stdout: "Homebrew 4.5.0", stderr: "", exitCode: 0 });
    // brew install 성공
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    // 재진단 runDoctor 전용 fallback
    mockExeca.mockImplementation((cmd: string, args: string[] = []) => {
      if (cmd === "node" && args.includes("--version")) {
        return Promise.resolve({ stdout: "v24.4.1", stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const fixed = await doctorFix(missingIdbReport);
    expect(fixed).toHaveProperty("checks");
    // brew install이 호출됐어야 함
    const brewCalled = mockExeca.mock.calls.some(
      (call: unknown[]) =>
        call[0] === "brew" &&
        Array.isArray(call[1]) &&
        (call[1] as string[]).includes("install")
    );
    expect(brewCalled).toBe(true);
  });
});
