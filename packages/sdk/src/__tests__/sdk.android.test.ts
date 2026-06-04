/**
 * SDK 통합 테스트 — android-compose-basic fixture
 *
 * 별도 파일로 분리한 이유:
 *   tree-sitter WASM(tsx/kotlin/swift)이 한 프로세스에서 동시 로드되면
 *   V8 Turboshaft Zone OOM이 발생한다. 파일을 분리하면 vitest가
 *   각각을 독립 워커 프로세스로 실행하므로 WASM이 격리된다.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  detectFramework,
  listScreens,
  captureAll,
} from "../index.js";

const ANDROID_FIXTURE = path.resolve(process.cwd(), "../../fixtures/android-compose-basic");

describe("android-compose-basic fixture — detectFramework + listScreens + captureAll", () => {
  it("detectFramework: android가 1순위", async () => {
    const result = await detectFramework(ANDROID_FIXTURE);
    expect(result.frameworks.length).toBeGreaterThan(0);
    expect(result.frameworks[0].id).toBe("android");
    expect(result.frameworks[0].confidence).toBeGreaterThan(0.5);
  });

  it("listScreens: 5개 화면 발견", async () => {
    const screens = await listScreens({
      projectPath: ANDROID_FIXTURE,
      includeCandidates: true,
    });
    expect(screens.length).toBe(5);
    for (const s of screens) {
      expect(s).toHaveProperty("id");
      expect(["route", "candidate"]).toContain(s.discovery);
      expect(typeof s.confidence).toBe("number");
    }
  });

  it("captureAll: mode:static — PNG 5장+report 생성", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-sdk-android-captureAll-"));
    process.env.SFC_SKIP_ENSURE = "1";
    try {
      const result = await captureAll({
        projectPath: ANDROID_FIXTURE,
        outDir: tmpDir,
        captureMode: "static",
        mockSeed: 42,
      });

      expect(result.screens.length).toBe(5);
      expect(result.report.failures).toHaveLength(0);
      expect(result.report.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result.report.overallConfidence).toBeLessThanOrEqual(1);
      expect(result.report.limitations.length).toBeGreaterThan(0);

      for (const screen of result.screens) {
        expect(fs.existsSync(screen.pngPath)).toBe(true);
        // [중간-5] report.json은 device 접미사 포함: {screenId}_{device}.report.json
        const reportPath = path.join(tmpDir, `${screen.screenId}_iphone-15.report.json`);
        expect(fs.existsSync(reportPath)).toBe(true);
      }
    } finally {
      delete process.env.SFC_SKIP_ENSURE;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});
