/**
 * captureScreen ctx maxInlineDepth 전달 검증 (중간-6 회귀)
 *
 * captureScreen이 어댑터의 discoverScreens 호출 시 maxInlineDepth를
 * ctx에 포함해서 전달하는지를 직접 검증한다.
 * fix를 revert하면(ctx에서 maxInlineDepth 제거) 이 테스트가 실패해야 한다.
 *
 * 구현: @karax/adapter-flutter를 vi.mock으로 교체해 ctx를 캡처한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AdapterContext, FrameworkAdapter, ScreenSummary } from "@karax/adapter-api";
import type { IRDocument } from "@karax/core";
import * as path from "path";

const FLUTTER_FIXTURE = path.resolve(
  process.cwd(),
  "../../fixtures/flutter-basic"
);

// ── 캡처된 ctx를 담을 공유 배열 ────────────────────────────────────────
const capturedCtxCalls: AdapterContext[] = [];

// stub IRDocument — discoverScreens/buildScreenIR mock 반환값
const STUB_SCREEN: ScreenSummary = {
  id: "StubScreen",
  discovery: "route",
  confidence: 1.0,
  sourceRef: { file: "lib/stub.dart" },
};

const STUB_IR: IRDocument = {
  schemaVersion: "0.1",
  screen: {
    id: "StubScreen",
    discovery: "route",
    confidence: 1.0,
    root: { type: "Column", confidence: 1.0, children: [] },
  },
  designTokens: {},
  diagnostics: [],
};

// ── flutter adapter mock ────────────────────────────────────────────────
// vi.mock은 hoisted되므로 capturedCtxCalls에 직접 접근 가능
vi.mock("@karax/adapter-flutter", () => {
  const mockAdapter: FrameworkAdapter = {
    id: "flutter" as const,
    async detect() {
      return { matches: true, confidence: 1.0, evidence: [] };
    },
    async discoverScreens(ctx: AdapterContext) {
      capturedCtxCalls.push({ ...ctx, _source: "discoverScreens" } as AdapterContext & { _source: string });
      return [STUB_SCREEN];
    },
    async buildScreenIR(ctx: AdapterContext) {
      capturedCtxCalls.push({ ...ctx, _source: "buildScreenIR" } as AdapterContext & { _source: string });
      return STUB_IR;
    },
  };
  return { flutterAdapter: mockAdapter };
});

// ── renderScreenshot mock — Playwright 없이 동작하게 ───────────────────
vi.mock("@karax/renderer", () => ({
  renderScreenshot: vi.fn().mockResolvedValue({
    pngPath: "/tmp/stub.png",
    width: 390,
    height: 844,
  }),
}));

// ── captureEngine mock — Tier 결정 없이 바로 static 결과 반환 ──────────
vi.mock("@karax/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@karax/core")>();
  return {
    ...actual,
    captureScreenWithTiers: vi.fn().mockResolvedValue({
      screenId: "StubScreen",
      pngPath: "/tmp/stub.png",
      width: 390,
      height: 844,
      tierUsed: "static" as const,
      confidence: 0.9,
      diagnostics: [],
    }),
  };
});

describe("captureScreen — maxInlineDepth ctx 전달 (중간-6 회귀)", () => {
  beforeEach(() => {
    process.env.KARAX_SKIP_ENSURE = "1";
    capturedCtxCalls.length = 0;
  });

  afterEach(() => {
    delete process.env.KARAX_SKIP_ENSURE;
  });

  it(
    "maxInlineDepth 옵션이 어댑터 discoverScreens의 ctx에 포함되어 전달됨",
    async () => {
      const { captureScreen } = await import("../index.js");

      const MAX_INLINE_DEPTH = 3;

      await captureScreen({
        projectPath: FLUTTER_FIXTURE,
        screenId: "StubScreen",
        framework: "flutter",
        captureMode: "static",
        mockSeed: 0,
        maxInlineDepth: MAX_INLINE_DEPTH,
      });

      // captureScreen 내부에서 discoverScreens가 호출됐는지 확인
      const discoverCalls = capturedCtxCalls.filter(
        (c) => (c as AdapterContext & { _source: string })._source === "discoverScreens"
      );
      expect(discoverCalls.length).toBeGreaterThan(0);

      // 모든 discoverScreens 호출에서 maxInlineDepth가 MAX_INLINE_DEPTH여야 한다
      for (const ctx of discoverCalls) {
        expect(ctx.maxInlineDepth).toBe(MAX_INLINE_DEPTH);
      }
    },
    15_000
  );

  it(
    "maxInlineDepth를 지정하지 않으면 ctx.maxInlineDepth가 undefined",
    async () => {
      const { captureScreen } = await import("../index.js");

      await captureScreen({
        projectPath: FLUTTER_FIXTURE,
        screenId: "StubScreen",
        framework: "flutter",
        captureMode: "static",
      });

      const discoverCalls = capturedCtxCalls.filter(
        (c) => (c as AdapterContext & { _source: string })._source === "discoverScreens"
      );
      expect(discoverCalls.length).toBeGreaterThan(0);

      for (const ctx of discoverCalls) {
        // maxInlineDepth 미지정 시 undefined
        expect(ctx.maxInlineDepth).toBeUndefined();
      }
    },
    15_000
  );
});
