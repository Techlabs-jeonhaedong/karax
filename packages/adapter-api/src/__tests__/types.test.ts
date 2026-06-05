import { describe, expect, it } from "vitest";
import type {
  AdapterContext,
  CaptureOptions,
  CompileBackend,
  CompileEnvironment,
  DetectResult,
  FrameworkAdapter,
  ScreenSummary,
} from "../types.js";
import type { IRDocument } from "@karax/core";

/**
 * 인터페이스 적합성 테스트 — 스텁 구현체가 타입 체크 통과하는지 확인.
 * 런타임에는 스텁이 올바른 형태의 값을 반환하는지만 검증한다.
 */

describe("FrameworkAdapter 인터페이스 적합성", () => {
  const stubAdapter: FrameworkAdapter = {
    id: "flutter",

    async detect(_projectPath: string) {
      return { matches: false, confidence: 0, evidence: [] };
    },

    async discoverScreens(_ctx: AdapterContext): Promise<ScreenSummary[]> {
      return [];
    },

    async buildScreenIR(
      _ctx: AdapterContext,
      _screenId: string
    ): Promise<IRDocument> {
      return {
        schemaVersion: "0.1",
        screen: {
          id: "stub",
          discovery: "candidate",
          confidence: 0,
          root: { type: "Box", confidence: 0 },
        },
        designTokens: {},
        diagnostics: [],
      };
    },
  };

  it("id가 FrameworkId 중 하나", () => {
    expect(["flutter", "react-native", "ios", "android"]).toContain(
      stubAdapter.id
    );
  });

  it("detect()가 올바른 형태 반환", async () => {
    const result = await stubAdapter.detect("/fake/path");
    expect(result).toHaveProperty("matches");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("evidence");
    expect(typeof result.confidence).toBe("number");
  });

  it("discoverScreens()가 배열 반환", async () => {
    const ctx: AdapterContext = { projectPath: "/fake" };
    const screens = await stubAdapter.discoverScreens(ctx);
    expect(Array.isArray(screens)).toBe(true);
  });

  it("buildScreenIR()가 IRDocument 형태 반환", async () => {
    const ctx: AdapterContext = { projectPath: "/fake" };
    const ir = await stubAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(ir).toHaveProperty("schemaVersion");
    expect(ir).toHaveProperty("screen");
    expect(ir.screen).toHaveProperty("root");
  });
});

describe("CompileBackend 인터페이스 적합성", () => {
  const stubScreen: ScreenSummary = {
    id: "HomeScreen",
    discovery: "route",
    confidence: 0.9,
  };

  const stubBackend: CompileBackend = {
    id: "flutter",

    async isAvailable(_env: CompileEnvironment): Promise<boolean> {
      return false;
    },

    async capture(_ctx, _screen, _opts) {
      throw new Error("not available");
    },
  };

  it("id가 FrameworkId 중 하나", () => {
    expect(["flutter", "react-native", "ios", "android"]).toContain(
      stubBackend.id
    );
  });

  it("isAvailable()이 boolean 반환", async () => {
    const env: CompileEnvironment = {};
    const result = await stubBackend.isAvailable(env);
    expect(typeof result).toBe("boolean");
  });

  it("isAvailable() false일 때 capture() throw", async () => {
    const ctx: AdapterContext = { projectPath: "/fake" };
    const opts: CaptureOptions = { outDir: "/tmp" };
    await expect(stubBackend.capture(ctx, stubScreen, opts)).rejects.toThrow();
  });
});

describe("DetectResult 타입", () => {
  it("빈 frameworks 배열 허용", () => {
    const result: DetectResult = { frameworks: [] };
    expect(result.frameworks).toHaveLength(0);
  });

  it("복수 프레임워크 후보 허용", () => {
    const result: DetectResult = {
      frameworks: [
        {
          id: "flutter",
          confidence: 0.9,
          evidence: [{ type: "file", description: "pubspec.yaml found" }],
        },
        {
          id: "react-native",
          confidence: 0.3,
          evidence: [{ type: "dependency", description: "react-native in deps" }],
        },
      ],
    };
    expect(result.frameworks).toHaveLength(2);
    expect(result.frameworks[0]!.id).toBe("flutter");
  });
});
