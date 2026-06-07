/**
 * compile-ios keepWorkDir 와이어링 테스트
 *
 * CaptureOptions.keepWorkDir=true가 runXcodebuildTest(keepWorkDir=true)까지 전파되는지 검증.
 * xcodebuild/simctl 없이 단위 테스트로 검증 — runner를 vi.mock으로 교체.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { AdapterContext, ScreenSummary } from "@karax/adapter-api";

const FAKE_SIMULATOR = {
  udid: "FAKE-UDID-0000",
  name: "iPhone 15",
  runtime: "iOS 17.2",
};

const FAKE_RUN_RESULT = {
  pngPath: "/tmp/fake/test.png",
  width: 390,
  height: 844,
};

// runner를 mock해서 실제 xcodebuild/simctl 없이 검증한다
vi.mock("../runner.js", () => ({
  isXcodebuildAvailable: vi.fn().mockResolvedValue(true),
  hasIosSimulatorRuntime: vi.fn().mockResolvedValue(true),
  detectAvailableSimulator: vi.fn().mockResolvedValue(FAKE_SIMULATOR),
  runXcodebuildTest: vi.fn().mockResolvedValue(FAKE_RUN_RESULT),
  CompileCaptureError: class CompileCaptureError extends Error {
    code: string;
    constructor(code: string, message: string, _stderr: string) {
      super(message);
      this.code = code;
      this.name = "CompileCaptureError";
    }
  },
  classifyXcodebuildError: vi.fn().mockReturnValue(null),
}));

vi.mock("../harness/generator.js", () => ({
  generateHarness: vi.fn().mockResolvedValue({
    workDir: "/tmp/fake-harness-ios",
    schemeName: "KaraxHarness",
    outPath: "/tmp/fake-harness-ios/result.png",
  }),
  selectSimulator: vi.fn().mockReturnValue(FAKE_SIMULATOR),
}));

const BASE_CTX: AdapterContext = {
  projectPath: "/tmp/fake-project",
  framework: "ios",
  device: "iphone-15",
  mockSeed: 42,
};

const BASE_SCREEN: ScreenSummary = {
  id: "HomeView",
  discovery: "route",
  confidence: 0.9,
  sourceRef: { file: "Sources/HomeView.swift", symbol: "HomeView" },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("iosSimulatorBackend.capture — keepWorkDir 와이어링", () => {
  it("keepWorkDir=true 시 runXcodebuildTest에 keepWorkDir=true가 전달된다", async () => {
    const { iosSimulatorBackend } = await import("../index.js");
    const { runXcodebuildTest } = await import("../runner.js");

    await iosSimulatorBackend.capture(BASE_CTX, BASE_SCREEN, {
      outDir: "/tmp/fake-out",
      keepWorkDir: true,
    });

    expect(runXcodebuildTest).toHaveBeenCalledOnce();
    const callArg = (runXcodebuildTest as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      keepWorkDir: boolean;
    };
    expect(callArg.keepWorkDir).toBe(true);
  });

  it("keepWorkDir=false 시 runXcodebuildTest에 keepWorkDir=false가 전달된다", async () => {
    const { iosSimulatorBackend } = await import("../index.js");
    const { runXcodebuildTest } = await import("../runner.js");

    await iosSimulatorBackend.capture(BASE_CTX, BASE_SCREEN, {
      outDir: "/tmp/fake-out",
      keepWorkDir: false,
    });

    const callArg = (runXcodebuildTest as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      keepWorkDir: boolean;
    };
    expect(callArg.keepWorkDir).toBe(false);
  });

  it("keepWorkDir 미지정 시 runXcodebuildTest에 keepWorkDir=false(기본값)가 전달된다", async () => {
    const { iosSimulatorBackend } = await import("../index.js");
    const { runXcodebuildTest } = await import("../runner.js");

    await iosSimulatorBackend.capture(BASE_CTX, BASE_SCREEN, {
      outDir: "/tmp/fake-out",
    });

    const callArg = (runXcodebuildTest as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      keepWorkDir: boolean;
    };
    expect(callArg.keepWorkDir).toBe(false);
  });
});
