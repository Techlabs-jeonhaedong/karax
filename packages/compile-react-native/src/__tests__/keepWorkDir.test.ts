/**
 * compile-react-native keepWorkDir 실패 분기 테스트 (Phase C 검수 누락 4)
 *
 * generateHarness 실패를 mock으로 유도해:
 * - keepWorkDir=true → workDir 잔존 (보존)
 * - keepWorkDir=false → workDir 삭제 (정리)
 *
 * 단위 테스트 수준으로 검증 — 실제 esbuild/Playwright 실행 없음.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { AdapterContext, ScreenSummary } from "@karax/adapter-api";

// ── 테스트용 workDir 해시 계산 ───────────────────────────────────────────────
// index.ts 내부와 동일한 해시 공식으로 leakedDir 경로를 예측한다.
import { createHash } from "crypto";

function expectedLeakedDir(projectPath: string, screenId: string, device: string, mockSeed: number): string {
  const hash = createHash("sha256")
    .update(`${projectPath}:${screenId}:${device}:${mockSeed}`)
    .digest("hex")
    .slice(0, 12);
  return path.join(os.tmpdir(), `karax-rn-${hash}`);
}

// ── mock 설정 ────────────────────────────────────────────────────────────────

const MOCK_PROJECT = "/tmp/fake-rn-project";
const MOCK_SCREEN: ScreenSummary = {
  id: "TestScreen",
  discovery: "route",
  confidence: 0.9,
  sourceRef: { file: "src/screens/TestScreen.tsx", symbol: "TestScreen" },
};
const MOCK_CTX: AdapterContext = {
  projectPath: MOCK_PROJECT,
  framework: "react-native",
  device: "pixel-8",
  mockSeed: 42,
};

// generateHarness가 throw하도록 mock
vi.mock("../harness/generator.js", () => ({
  generateHarness: vi.fn().mockImplementation(() => {
    throw new Error("BUNDLE_FAILED: mock harness error");
  }),
}));

// runner는 사용하지 않지만 import 오류 방지용 stub
vi.mock("../runner.js", () => ({
  runRnWebCapture: vi.fn().mockResolvedValue({ width: 100, height: 200, mockedModules: [] }),
  CompileCaptureError: class CompileCaptureError extends Error {
    code: string;
    constructor(code: string, message: string, _stderr: string) {
      super(message);
      this.code = code;
      this.name = "CompileCaptureError";
    }
  },
}));

const leakedDir = expectedLeakedDir(MOCK_PROJECT, MOCK_SCREEN.id, "pixel-8", 42);

beforeEach(() => {
  // 테스트 시작 전 leakedDir가 없는지 확인 후 정리
  try { fs.rmSync(leakedDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

afterEach(() => {
  vi.clearAllMocks();
  // leakedDir 잔존 정리 (테스트 간 격리)
  try { fs.rmSync(leakedDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("compile-react-native — generateHarness 실패 시 keepWorkDir 분기", () => {
  it("keepWorkDir=false 시 generateHarness 실패 후 leakedDir가 삭제된다", async () => {
    // leakedDir를 미리 생성해서 "정리 대상"을 시뮬레이션
    fs.mkdirSync(leakedDir, { recursive: true });
    expect(fs.existsSync(leakedDir)).toBe(true);

    const { rnWebCompileBackend } = await import("../index.js");

    await expect(
      rnWebCompileBackend.capture(MOCK_CTX, MOCK_SCREEN, {
        outDir: "/tmp/fake-out",
        keepWorkDir: false,
        mockSeed: 42,
      })
    ).rejects.toThrow();

    // keepWorkDir=false → leakedDir가 삭제돼야 한다
    expect(fs.existsSync(leakedDir)).toBe(false);
  });

  it("keepWorkDir=true 시 generateHarness 실패 후 leakedDir가 잔존한다", async () => {
    // leakedDir를 미리 생성해서 "보존 대상"을 시뮬레이션
    fs.mkdirSync(leakedDir, { recursive: true });
    expect(fs.existsSync(leakedDir)).toBe(true);

    const debugEvents: Array<{ tag: string; message: string }> = [];
    const { rnWebCompileBackend } = await import("../index.js");

    await expect(
      rnWebCompileBackend.capture(MOCK_CTX, MOCK_SCREEN, {
        outDir: "/tmp/fake-out",
        keepWorkDir: true,
        mockSeed: 42,
        onDebug: (e) => debugEvents.push(e),
      })
    ).rejects.toThrow();

    // keepWorkDir=true → leakedDir가 보존돼야 한다
    expect(fs.existsSync(leakedDir)).toBe(true);

    // onDebug로 보존 경로 안내가 왔어야 한다
    expect(debugEvents.some((e) => e.tag === "compile-rn" && e.message.includes(leakedDir))).toBe(true);
  });

  it("keepWorkDir 미지정(기본값) 시 generateHarness 실패 후 leakedDir가 삭제된다", async () => {
    fs.mkdirSync(leakedDir, { recursive: true });
    const { rnWebCompileBackend } = await import("../index.js");

    await expect(
      rnWebCompileBackend.capture(MOCK_CTX, MOCK_SCREEN, {
        outDir: "/tmp/fake-out",
        mockSeed: 42,
        // keepWorkDir 미지정 → false
      })
    ).rejects.toThrow();

    expect(fs.existsSync(leakedDir)).toBe(false);
  });
});
