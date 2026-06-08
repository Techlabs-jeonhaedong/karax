/**
 * compile-android keepWorkDir 와이어링 테스트
 *
 * CaptureOptions.keepWorkDir=true가 runPaparazziTest(keepWorkDir=true)까지 전파되는지 검증.
 * Gradle/JVM 없이 단위 테스트로 검증 — runner를 vi.mock으로 교체.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { AdapterContext, ScreenSummary } from "@karax/adapter-api";

const FAKE_RESULT = {
  pngPath: "/tmp/fake/test.png",
  width: 1080,
  height: 1920,
};

// runner와 harness를 mock해서 실제 JVM/Gradle 없이 검증한다
vi.mock("../runner.js", () => ({
  runPaparazziTest: vi.fn().mockResolvedValue(FAKE_RESULT),
  CompileCaptureError: class CompileCaptureError extends Error {
    code: string;
    constructor(code: string, message: string, _stderr: string) {
      super(message);
      this.code = code;
      this.name = "CompileCaptureError";
    }
  },
  classifyGradleError: vi.fn().mockReturnValue(null),
}));

vi.mock("../harness/generator.js", () => ({
  generateHarness: vi.fn().mockResolvedValue({
    workDir: "/tmp/fake-harness-android",
    snapshotDir: "/tmp/fake-harness-android/snapshots",
    screenName: "TestScreen",
  }),
}));

// detectAndroidSdk를 우회하기 위해 ANDROID_HOME 설정
vi.stubEnv("ANDROID_HOME", "/fake/android-sdk");

const BASE_CTX: AdapterContext = {
  projectPath: "/tmp/fake-project",
  framework: "android",
  device: "pixel-8",
  mockSeed: 42,
};

const BASE_SCREEN: ScreenSummary = {
  id: "TestScreen",
  discovery: "route",
  confidence: 0.9,
  sourceRef: { file: "app/src/main/java/TestScreen.kt", symbol: "TestScreen" },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("androidPaparazziBackend.capture — keepWorkDir 와이어링", () => {
  it("keepWorkDir=true 시 runPaparazziTest에 keepWorkDir=true가 전달된다", async () => {
    const { androidPaparazziBackend } = await import("../index.js");
    const { runPaparazziTest } = await import("../runner.js");

    await androidPaparazziBackend.capture(BASE_CTX, BASE_SCREEN, {
      outDir: "/tmp/fake-out",
      keepWorkDir: true,
    });

    expect(runPaparazziTest).toHaveBeenCalledOnce();
    const callArg = (runPaparazziTest as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      keepWorkDir: boolean;
    };
    expect(callArg.keepWorkDir).toBe(true);
  });

  it("keepWorkDir=false 시 runPaparazziTest에 keepWorkDir=false가 전달된다", async () => {
    const { androidPaparazziBackend } = await import("../index.js");
    const { runPaparazziTest } = await import("../runner.js");

    await androidPaparazziBackend.capture(BASE_CTX, BASE_SCREEN, {
      outDir: "/tmp/fake-out",
      keepWorkDir: false,
    });

    const callArg = (runPaparazziTest as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      keepWorkDir: boolean;
    };
    expect(callArg.keepWorkDir).toBe(false);
  });

  it("keepWorkDir 미지정 시 runPaparazziTest에 keepWorkDir=false(기본값)가 전달된다", async () => {
    const { androidPaparazziBackend } = await import("../index.js");
    const { runPaparazziTest } = await import("../runner.js");

    await androidPaparazziBackend.capture(BASE_CTX, BASE_SCREEN, {
      outDir: "/tmp/fake-out",
    });

    const callArg = (runPaparazziTest as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      keepWorkDir: boolean;
    };
    // 기본값은 false여야 한다 (하드코딩 false가 아닌, opts에서 유래한 false)
    expect(callArg.keepWorkDir).toBe(false);
  });
});
