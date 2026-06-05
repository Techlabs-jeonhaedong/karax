import { describe, expect, it, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  detectFramework,
  listScreens,
  buildScreenIR,
  captureScreen,
  captureAll,
  doctor,
  doctorFix,
  SDK_VERSION,
} from "../index.js";

const FLUTTER_FIXTURE = path.resolve(
  process.cwd(),
  "../../fixtures/flutter-basic"
);


// ── 기본 export 확인 ────────────────────────────────────────────────

describe("SDK exports", () => {
  it("SDK_VERSION이 string이어야 한다", () => {
    expect(typeof SDK_VERSION).toBe("string");
  });
});

// ── detectFramework ─────────────────────────────────────────────────

describe("detectFramework", () => {
  it("flutter-basic fixture를 flutter로 감지해야 한다", async () => {
    const result = await detectFramework(FLUTTER_FIXTURE);
    expect(result.frameworks.length).toBeGreaterThan(0);
    expect(result.frameworks[0].id).toBe("flutter");
    expect(result.frameworks[0].confidence).toBeGreaterThan(0.5);
  });

  it("존재하지 않는 경로도 에러 없이 빈 candidates 반환", async () => {
    const result = await detectFramework("/nonexistent/path/xyz");
    expect(result.frameworks).toBeDefined();
    expect(Array.isArray(result.frameworks)).toBe(true);
  });

  it("미지원 프레임워크 경로에서 flutter가 1위 아닌 경우 빈 배열 가능", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-test-"));
    const result = await detectFramework(tmpDir);
    // 에러가 아닌 빈 배열(또는 낮은 confidence)를 반환해야 함
    expect(Array.isArray(result.frameworks)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── doctor ─────────────────────────────────────────────────────────

describe("doctor", () => {
  it("DoctorReport 구조를 반환해야 한다", async () => {
    const report = await doctor();
    expect(report).toHaveProperty("checks");
    expect(report).toHaveProperty("tiersAvailable");
    expect(report).toHaveProperty("overallOk");
    expect(Array.isArray(report.checks)).toBe(true);
  });

  it("projectPath 지정 시에도 정상 반환", async () => {
    const report = await doctor(FLUTTER_FIXTURE);
    expect(report.checks.length).toBeGreaterThan(0);
  });
});

describe("doctorFix", () => {
  it("DoctorReport를 받아 재진단 리포트를 반환해야 한다", async () => {
    // doctorFix는 autoInstallable 항목(Chromium)을 실제 설치 시도할 수 있다.
    // 테스트에서는 overallOk=true 상태의 mock report를 넘겨 설치 경로를 우회한다.
    const mockReport: import("@karax/doctor").DoctorReport = {
      checks: [
        { id: "node", label: "Node.js", status: "ok", version: "20.0.0", autoInstallable: false, hint: "" },
      ],
      tiersAvailable: {
        flutter: { tier1: false, tier2: true, missing: ["flutter"] },
        "react-native": { tier1: false, tier2: true, missing: ["node"] },
        android: { tier1: false, tier2: true, missing: ["java", "gradle"] },
        ios: { tier1: false, tier2: true, missing: ["xcodebuild"] },
      },
      overallOk: true,
    };
    const report = await doctorFix(mockReport);
    expect(report).toHaveProperty("checks");
    expect(report).toHaveProperty("tiersAvailable");
    expect(report).toHaveProperty("overallOk");
  });
});

// ── listScreens ─────────────────────────────────────────────────────

describe("listScreens", () => {
  it("flutter-basic fixture에서 화면 목록을 반환해야 한다", async () => {
    const screens = await listScreens({ projectPath: FLUTTER_FIXTURE });
    expect(screens.length).toBeGreaterThanOrEqual(1);
    // 각 화면은 ScreenSummary 구조
    for (const s of screens) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("discovery");
      expect(s.discovery === "route" || s.discovery === "candidate").toBe(true);
      expect(typeof s.confidence).toBe("number");
    }
  });

  it("flutter-basic fixture에서 5개 화면을 발견해야 한다", async () => {
    const screens = await listScreens({
      projectPath: FLUTTER_FIXTURE,
      includeCandidates: true,
    });
    expect(screens.length).toBe(5);
  });

  it("includeCandidates=false 시 route만 포함", async () => {
    const screens = await listScreens({
      projectPath: FLUTTER_FIXTURE,
      includeCandidates: false,
    });
    for (const s of screens) {
      expect(s.discovery).toBe("route");
    }
  });

  it("framework 미지정 시 자동 감지로 동작해야 한다", async () => {
    const screens = await listScreens({ projectPath: FLUTTER_FIXTURE });
    expect(screens.length).toBeGreaterThan(0);
  });
});

// ── buildScreenIR ───────────────────────────────────────────────────

describe("buildScreenIR", () => {
  it("flutter-basic fixture에서 IR 문서를 반환해야 한다", async () => {
    const screens = await listScreens({
      projectPath: FLUTTER_FIXTURE,
      includeCandidates: false,
    });
    expect(screens.length).toBeGreaterThan(0);

    const docs = await buildScreenIR({
      projectPath: FLUTTER_FIXTURE,
      screenId: screens[0].id,
    });
    expect(docs.length).toBe(1);
    expect(docs[0]).toHaveProperty("schemaVersion");
    expect(docs[0]).toHaveProperty("screen");
    expect(docs[0].screen.id).toBe(screens[0].id);
  });

  it("screenId 미지정 시 전체 화면 IR 반환", async () => {
    const docs = await buildScreenIR({ projectPath: FLUTTER_FIXTURE });
    expect(docs.length).toBeGreaterThan(0);
  });
});

// ── captureAll (mode:static) ────────────────────────────────────────

describe("captureAll — static 모드 (KARAX_SKIP_ENSURE=1 필요)", () => {
  it("flutter-basic fixture에서 PNG+report.json+AnalysisReport 생성", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-captureAll-"));
    process.env.KARAX_SKIP_ENSURE = "1";

    try {
      const result = await captureAll({
        projectPath: FLUTTER_FIXTURE,
        outDir: tmpDir,
        captureMode: "static",
        mockSeed: 42,
      });

      // AnalysisReport 구조
      expect(result.report).toHaveProperty("screens");
      expect(result.report).toHaveProperty("overallConfidence");
      expect(result.report).toHaveProperty("limitations");
      expect(result.report).toHaveProperty("failures");
      expect(Array.isArray(result.report.limitations)).toBe(true);
      expect(Array.isArray(result.report.failures)).toBe(true);
      // PLAN 12절: static 모드에서도 limitations는 비어있지 않아야 한다 (Tier 2 한계 고정 문구 포함)
      expect(result.report.limitations.length).toBeGreaterThan(0);
      // Tier 2 한계 고정 문구가 포함돼야 한다
      expect(result.report.limitations.some((l) => l.includes("픽셀 퍼펙트"))).toBe(true);
      // 전체 성공 시 failures는 빈 배열
      expect(result.report.failures).toHaveLength(0);

      // 화면 수
      expect(result.screens.length).toBeGreaterThanOrEqual(1);

      // 각 화면에 PNG+report.json이 있어야 한다
      for (const screen of result.screens) {
        expect(fs.existsSync(screen.pngPath)).toBe(true);
        // [중간-5] report.json은 device 접미사 포함: {screenId}_{device}.report.json
        // captureAll의 기본 device: iphone-15
        const reportPath = path.join(tmpDir, `${screen.screenId}_iphone-15.report.json`);
        expect(fs.existsSync(reportPath)).toBe(true);
      }

      // overallConfidence는 [0, 1]
      expect(result.report.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result.report.overallConfidence).toBeLessThanOrEqual(1);
    } finally {
      delete process.env.KARAX_SKIP_ENSURE;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("outDir 없으면 타입에러 (실행 시 에러)", async () => {
    // @ts-expect-error outDir은 필수
    await expect(captureAll({ projectPath: FLUTTER_FIXTURE })).rejects.toThrow();
  });
});

// ── captureScreen ──────────────────────────────────────────────────

describe("captureScreen — static 모드", () => {
  it("특정 screenId PNG를 생성해야 한다", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-cap-"));
    process.env.KARAX_SKIP_ENSURE = "1";

    try {
      const screens = await listScreens({
        projectPath: FLUTTER_FIXTURE,
        includeCandidates: false,
      });
      const targetId = screens[0].id;

      const result = await captureScreen({
        projectPath: FLUTTER_FIXTURE,
        screenId: targetId,
        outDir: tmpDir,
        captureMode: "static",
        mockSeed: 0,
      });

      expect(result.screenId).toBe(targetId);
      expect(result.tierUsed).toBe("static");
      expect(fs.existsSync(result.pngPath)).toBe(true);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    } finally {
      delete process.env.KARAX_SKIP_ENSURE;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── captureScreen — Tier 1 통합 (KARAX_FLUTTER_INTEGRATION=1 가드) ──

describe("captureScreen — Tier 1 실제 실행 (flutter 설치 필요)", () => {
  const RUN = process.env.KARAX_FLUTTER_INTEGRATION === "1";

  it.skipIf(!RUN)(
    "flutter fixture에서 Tier 1 캡처 성공 (1건)",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-tier1-"));
      // ensureChromium npx CLI 의존 방지 — Playwright Node API 탐지가 정상이므로 ensure 불필요
      process.env.KARAX_SKIP_ENSURE = "1";
      try {
        const screens = await listScreens({
          projectPath: FLUTTER_FIXTURE,
          includeCandidates: false,
        });

        const result = await captureScreen({
          projectPath: FLUTTER_FIXTURE,
          screenId: screens[0].id,
          outDir: tmpDir,
          captureMode: "auto", // flutter 있으면 tier1 시도
          mockSeed: 0,
        });

        expect(result.tierUsed).toBe("compile");
        expect(fs.existsSync(result.pngPath)).toBe(true);
      } finally {
        delete process.env.KARAX_SKIP_ENSURE;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(!RUN)(
    "flutter 없는 화면(깨진 화면) auto → static fallback",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-sdk-tier1-fb-"));
      process.env.KARAX_SKIP_ENSURE = "1";
      try {
        // orphan_screen: candidate discovery, 하니스 파라미터 주입 어려울 수 있음
        const result = await captureScreen({
          projectPath: FLUTTER_FIXTURE,
          screenId: "OrphanScreen",
          outDir: tmpDir,
          captureMode: "auto",
          mockSeed: 0,
        });

        // Tier 1이든 static이든 PNG는 있어야 함
        expect(fs.existsSync(result.pngPath)).toBe(true);
        expect(["compile", "static"] as const).toContain(result.tierUsed);
      } finally {
        delete process.env.KARAX_SKIP_ENSURE;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});

