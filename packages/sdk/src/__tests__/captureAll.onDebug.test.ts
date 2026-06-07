/**
 * captureAll onDebug 콜백 전파 검증 (Phase A-5)
 *
 * captureAll 실패 경로에서 onDebug 이벤트를 수신하고,
 * failures[] 기존 형태는 변경 없음을 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdapterContext, FrameworkAdapter, ScreenSummary, DebugEvent } from "@karax/adapter-api";
import type { IRDocument } from "@karax/core";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

const FLUTTER_FIXTURE = path.resolve(
  process.cwd(),
  "../../fixtures/flutter-basic"
);

// ── stub 화면 ─────────────────────────────────────────────────────────────
const STUB_SCREEN_OK: ScreenSummary = {
  id: "OkScreen",
  discovery: "route",
  confidence: 1.0,
  sourceRef: { file: "lib/ok.dart" },
};

const STUB_SCREEN_FAIL: ScreenSummary = {
  id: "FailScreen",
  discovery: "route",
  confidence: 1.0,
  sourceRef: { file: "lib/fail.dart" },
};

const STUB_IR: IRDocument = {
  schemaVersion: "0.1",
  screen: {
    id: "OkScreen",
    discovery: "route",
    confidence: 1.0,
    root: { type: "Column", confidence: 1.0, children: [] },
  },
  designTokens: {},
  diagnostics: [],
};

// ── flutter adapter mock (FailScreen에서 buildScreenIR이 throw) ───────────
vi.mock("@karax/adapter-flutter", () => {
  const mockAdapter: FrameworkAdapter = {
    id: "flutter" as const,
    async detect() {
      return { matches: true, confidence: 1.0, evidence: [] };
    },
    async discoverScreens() {
      return [STUB_SCREEN_OK, STUB_SCREEN_FAIL];
    },
    async buildScreenIR(_ctx: AdapterContext, screenId: string) {
      if (screenId === "FailScreen") {
        throw new Error("FailScreen IR 빌드 실패 (테스트 의도)");
      }
      return { ...STUB_IR, screen: { ...STUB_IR.screen, id: screenId } };
    },
  };
  return { flutterAdapter: mockAdapter };
});

// renderer mock — buildScreenIR이 성공한 화면만 renderScreenshot까지 도달
vi.mock("@karax/renderer", () => ({
  renderScreenshot: vi.fn().mockImplementation(async (_ir: IRDocument, opts: { outDir: string }) => {
    const pngPath = path.join(opts.outDir, "OkScreen_iphone-15.png");
    fs.writeFileSync(pngPath, "");
    return { pngPath, width: 390, height: 844 };
  }),
  measureScreenLayouts: vi.fn().mockResolvedValue(new Map()),
}));

// compile backend mock — static만 사용
vi.mock("@karax/compile-flutter", () => ({
  flutterCompileBackend: {
    isAvailable: vi.fn().mockResolvedValue(false),
    capture: vi.fn(),
  },
}));

// doctor mock
vi.mock("@karax/doctor", () => ({
  runDoctor: vi.fn().mockResolvedValue({ checks: [], overall: "pass" }),
  doctorFix: vi.fn().mockResolvedValue({ checks: [], overall: "pass" }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KARAX_SKIP_ENSURE = "1";
});

describe("captureAll — onDebug 콜백", () => {
  it("캡처 실패 시 onDebug capture-failed 이벤트를 수신해야 한다", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-onDebug-"));
    try {
      const events: DebugEvent[] = [];
      const onDebug = (e: DebugEvent) => events.push(e);

      const { captureAll } = await import("../index.js");
      const { report } = await captureAll({
        projectPath: FLUTTER_FIXTURE,
        framework: "flutter",
        outDir: tmpDir,
        onDebug,
      });

      // FailScreen은 buildScreenIR에서 throw → captureAll catch 블록에서 failures에 추가
      expect(report.failures).toContain("FailScreen");
      // onDebug에 capture-failed 이벤트가 전달되어야 한다
      const failedEvent = events.find((e) => e.tag === "capture-failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.message).toContain("FailScreen");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("캡처 실패 시 failures[] 형태는 기존과 동일해야 한다 (하위호환)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-onDebug-compat-"));
    try {
      const { captureAll } = await import("../index.js");
      const { report } = await captureAll({
        projectPath: FLUTTER_FIXTURE,
        framework: "flutter",
        outDir: tmpDir,
      });

      // onDebug 없어도 failures[]는 정상 작동
      expect(Array.isArray(report.failures)).toBe(true);
      expect(report.failures).toContain("FailScreen");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("onDebug 없으면 에러 없이 동작해야 한다", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-onDebug-none-"));
    try {
      const { captureAll } = await import("../index.js");
      await expect(
        captureAll({
          projectPath: FLUTTER_FIXTURE,
          framework: "flutter",
          outDir: tmpDir,
          // onDebug 미지정
        })
      ).resolves.not.toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
