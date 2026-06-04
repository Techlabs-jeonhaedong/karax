import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  captureScreenWithTiers,
  type CaptureEngineDeps,
  type CaptureEngineOptions,
} from "../pipeline/captureEngine.js";
import type { IRDocument } from "../ir/schema.js";

// captureEngine은 core 내부 의존만 가져야 하므로,
// 테스트에서는 CompileCaptureError를 직접 모방한 클래스를 사용한다.
class CompileCaptureError extends Error {
  code: string;
  stderr: string;
  constructor(code: string, message: string, stderr = "") {
    super(message);
    this.name = "CompileCaptureError";
    this.code = code;
    this.stderr = stderr;
  }
}

// ── 공통 픽스처 ───────────────────────────────────────────────────

const SCREEN = {
  id: "HomeScreen",
  title: "Home Screen",
  discovery: "route" as const,
  confidence: 1.0,
  sourceRef: { file: "lib/home.dart", line: 10, symbol: "HomeScreen" },
};

const MOCK_IR: IRDocument = {
  schemaVersion: "0.1",
  screen: {
    id: "HomeScreen",
    sourceRef: { file: "lib/home.dart", line: 10, symbol: "HomeScreen" },
    device: "iphone-15",
    discovery: "route",
    confidence: 1.0,
    root: { type: "Box", confidence: 1.0, children: [] },
  },
  designTokens: { colors: {}, spacing: {}, typography: {} },
  diagnostics: [],
};

const COMPILE_RESULT = {
  screenId: "HomeScreen",
  pngPath: "/tmp/HomeScreen.png",
  width: 390,
  height: 844,
  tierUsed: "compile" as const,
  confidence: 0.95,
};

const STATIC_RESULT = {
  screenId: "HomeScreen",
  pngPath: "/tmp/HomeScreen_iphone-15.png",
  width: 390,
  height: 844,
  tierUsed: "static" as const,
  confidence: 0.8,
};

/** deps 헬퍼: 필드별 재정의 허용 */
function makeDeps(overrides: Partial<CaptureEngineDeps> = {}): CaptureEngineDeps {
  return {
    adapter: {
      buildScreenIR: vi.fn().mockResolvedValue(MOCK_IR),
    },
    compileBackend: {
      isAvailable: vi.fn().mockResolvedValue(true),
      capture: vi.fn().mockResolvedValue(COMPILE_RESULT),
    },
    renderScreenshot: vi.fn().mockResolvedValue({
      pngPath: STATIC_RESULT.pngPath,
      width: STATIC_RESULT.width,
      height: STATIC_RESULT.height,
    }),
    ...overrides,
  };
}

function makeOpts(overrides: Partial<CaptureEngineOptions> = {}): CaptureEngineOptions {
  return {
    projectPath: "/fake/project",
    screen: SCREEN,
    outDir: "/tmp/sfc-out",
    captureMode: "auto",
    device: "iphone-15",
    mockSeed: 42,
    clock: () => "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

// ── auto 모드 테스트 ──────────────────────────────────────────────

describe("captureScreenWithTiers — auto 모드", () => {
  it("Tier 1이 가용이고 capture 성공 시 compile 결과를 반환해야 한다", async () => {
    const deps = makeDeps();
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "auto" }));
    expect(result.tierUsed).toBe("compile");
    expect(result.screenId).toBe("HomeScreen");
    expect(result.confidence).toBe(0.95);
  });

  it("isAvailable=false 시 Tier 2로 fallback + COMPILE_FALLBACK diagnostic", async () => {
    const deps = makeDeps({
      compileBackend: {
        isAvailable: vi.fn().mockResolvedValue(false),
        capture: vi.fn(),
      },
    });
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "auto" }));
    expect(result.tierUsed).toBe("static");
    expect(result.diagnostics.some((d) => d.code === "COMPILE_FALLBACK")).toBe(true);
  });

  it("Tier 1 capture가 CompileCaptureError 던지면 Tier 2 fallback + COMPILE_FALLBACK", async () => {
    const deps = makeDeps({
      compileBackend: {
        isAvailable: vi.fn().mockResolvedValue(true),
        capture: vi.fn().mockRejectedValue(
          new CompileCaptureError("COMPILE_FAILED", "dart 에러", "Error: ...")
        ),
      },
    });
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "auto" }));
    expect(result.tierUsed).toBe("static");
    expect(result.diagnostics.some((d) => d.code === "COMPILE_FALLBACK")).toBe(true);
  });

  it("auto — compileBackend가 없으면 바로 static으로 간다", async () => {
    const deps = makeDeps({ compileBackend: undefined });
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "auto" }));
    expect(result.tierUsed).toBe("static");
  });
});

// ── compile 모드 테스트 ───────────────────────────────────────────

describe("captureScreenWithTiers — compile 모드", () => {
  it("Tier 1 성공 시 compile 결과를 반환해야 한다", async () => {
    const deps = makeDeps();
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "compile" }));
    expect(result.tierUsed).toBe("compile");
  });

  it("Tier 1 실패 시 에러를 그대로 전파해야 한다 (fallback 없음)", async () => {
    const deps = makeDeps({
      compileBackend: {
        isAvailable: vi.fn().mockResolvedValue(true),
        capture: vi.fn().mockRejectedValue(
          new CompileCaptureError("COMPILE_FAILED", "강제 실패", "")
        ),
      },
    });
    await expect(
      captureScreenWithTiers(deps, makeOpts({ captureMode: "compile" }))
    ).rejects.toThrow("강제 실패");
  });

  it("compileBackend가 없으면 즉시 에러", async () => {
    const deps = makeDeps({ compileBackend: undefined });
    await expect(
      captureScreenWithTiers(deps, makeOpts({ captureMode: "compile" }))
    ).rejects.toThrow();
  });
});

// ── static 모드 테스트 ────────────────────────────────────────────

describe("captureScreenWithTiers — static 모드", () => {
  it("Tier 2만 사용해야 한다", async () => {
    const deps = makeDeps();
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "static" }));
    expect(result.tierUsed).toBe("static");
    expect(deps.compileBackend!.capture).not.toHaveBeenCalled();
  });

  it("buildScreenIR과 renderScreenshot을 호출해야 한다", async () => {
    const deps = makeDeps();
    await captureScreenWithTiers(deps, makeOpts({ captureMode: "static" }));
    expect(deps.adapter.buildScreenIR).toHaveBeenCalled();
    expect(deps.renderScreenshot).toHaveBeenCalled();
  });
});

// ── 사이드카 report.json 테스트 ───────────────────────────────────

describe("captureScreenWithTiers — 사이드카 report.json", () => {
  it("outDir에 <screenId>_<device>.report.json을 생성해야 한다", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-test-"));
    const fakePng = path.join(tmpDir, "HomeScreen_iphone-15.png");
    fs.writeFileSync(fakePng, "");

    const deps = makeDeps({
      renderScreenshot: vi.fn().mockResolvedValue({
        pngPath: fakePng,
        width: 390,
        height: 844,
      }),
    });

    const opts = makeOpts({
      captureMode: "static",
      outDir: tmpDir,
      clock: () => "2026-06-04T00:00:00.000Z",
    });

    await captureScreenWithTiers(deps, opts);

    // [중간-5] PNG와 동일한 device 접미사: HomeScreen_iphone-15.report.json
    const reportPath = path.join(tmpDir, "HomeScreen_iphone-15.report.json");
    expect(fs.existsSync(reportPath)).toBe(true);

    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    expect(report.screenId).toBe("HomeScreen");
    expect(report.tierUsed).toBe("static");
    expect(report.generatedAt).toBe("2026-06-04T00:00:00.000Z");
    expect(report.device).toBe("iphone-15");
    expect(report.mockSeed).toBe(42);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("compile 티어 캡처 후에도 <screenId>_<device>.report.json이 생성돼야 한다", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-test-"));
    const fakePng = path.join(tmpDir, "HomeScreen.png");
    fs.writeFileSync(fakePng, "");

    const deps = makeDeps({
      compileBackend: {
        isAvailable: vi.fn().mockResolvedValue(true),
        capture: vi.fn().mockResolvedValue({
          ...COMPILE_RESULT,
          pngPath: fakePng,
        }),
      },
    });

    const opts = makeOpts({
      captureMode: "compile",
      outDir: tmpDir,
      clock: () => "2026-06-04T00:00:00.000Z",
    });

    await captureScreenWithTiers(deps, opts);

    // device 기본값 "iphone-15"가 makeOpts에 설정됨
    const reportPath = path.join(tmpDir, "HomeScreen_iphone-15.report.json");
    expect(fs.existsSync(reportPath)).toBe(true);

    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    expect(report.tierUsed).toBe("compile");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("device별로 별도 report.json이 생성돼 덮어쓰지 않는다 (중간-5 회귀)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-test-"));

    const fakePngA = path.join(tmpDir, "HomeScreen_iphone-15.png");
    const fakePngB = path.join(tmpDir, "HomeScreen_pixel-8.png");
    fs.writeFileSync(fakePngA, "");
    fs.writeFileSync(fakePngB, "");

    // device=iphone-15 캡처
    await captureScreenWithTiers(
      makeDeps({ renderScreenshot: vi.fn().mockResolvedValue({ pngPath: fakePngA, width: 390, height: 844 }) }),
      makeOpts({ captureMode: "static", outDir: tmpDir, device: "iphone-15" })
    );

    // device=pixel-8 캡처
    await captureScreenWithTiers(
      makeDeps({ renderScreenshot: vi.fn().mockResolvedValue({ pngPath: fakePngB, width: 412, height: 915 }) }),
      makeOpts({ captureMode: "static", outDir: tmpDir, device: "pixel-8" })
    );

    const reportA = path.join(tmpDir, "HomeScreen_iphone-15.report.json");
    const reportB = path.join(tmpDir, "HomeScreen_pixel-8.report.json");
    expect(fs.existsSync(reportA)).toBe(true);
    expect(fs.existsSync(reportB)).toBe(true);

    const parsedA = JSON.parse(fs.readFileSync(reportA, "utf-8"));
    const parsedB = JSON.parse(fs.readFileSync(reportB, "utf-8"));
    expect(parsedA.device).toBe("iphone-15");
    expect(parsedB.device).toBe("pixel-8");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── 결과 형태 테스트 ─────────────────────────────────────────────

describe("captureScreenWithTiers — 결과 형태", () => {
  it("static 결과에 diagnostics 배열이 있어야 한다", async () => {
    const deps = makeDeps();
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "static" }));
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("compile 결과에 screenId, pngPath, width, height, tierUsed, confidence가 있어야 한다", async () => {
    const deps = makeDeps();
    const result = await captureScreenWithTiers(deps, makeOpts({ captureMode: "compile" }));
    expect(result).toMatchObject({
      screenId: expect.any(String),
      pngPath: expect.any(String),
      width: expect.any(Number),
      height: expect.any(Number),
      tierUsed: "compile",
      confidence: expect.any(Number),
    });
  });
});
