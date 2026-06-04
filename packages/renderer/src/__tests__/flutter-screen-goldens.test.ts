/**
 * Flutter 화면별 골든 이미지 테스트
 * buildScreenIR(fixture) → renderScreenshot → pixelmatch diff ≤ 0.5%
 *
 * 골든 갱신: UPDATE_GOLDENS=1 환경변수를 설정하고 실행할 것.
 * CI=true 환경에서는 골든이 없으면 FAIL (자동 생성 금지).
 * 로컬 비-갱신 모드에서도 골든이 없으면 FAIL.
 */

import { readFileSync, existsSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, afterEach } from "vitest";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { IRDocument } from "@sfc/core";
import { renderScreenshot } from "../capture/capture.js";
import { flutterAdapter } from "@sfc/adapter-flutter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDENS_DIR = resolve(__dirname, "__goldens__/flutter-screens");
const TMP_DIR = resolve(__dirname, "__flutter_golden_tmp__");

const SCREENS = [
  { id: "HomeScreen", device: "iphone-15" as const },
  { id: "DetailScreen", device: "iphone-15" as const },
  { id: "ListScreen", device: "iphone-15" as const },
  { id: "SettingsScreen", device: "iphone-15" as const },
  { id: "OrphanScreen", device: "iphone-15" as const },
];

const FIXTURES_DIR = resolve(__dirname, "../../../../fixtures");
const CTX = {
  projectPath: resolve(FIXTURES_DIR, "flutter-basic"),
  framework: "flutter" as const,
  includeCandidates: true,
  mockSeed: 42,
};

const GOLDENS_THRESHOLD = 0.005; // 0.5% — buildScreenIR→render 경로라 조금 더 허용

function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

function pixelDiffRatio(imgA: PNG, imgB: PNG): { diffPixels: number; totalPixels: number; ratio: number } {
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(`Size mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`);
  }
  const diffPixels = pixelmatch(imgA.data, imgB.data, undefined, imgA.width, imgA.height, {
    threshold: 0.1,
    includeAA: true,
  });
  const totalPixels = imgA.width * imgA.height;
  return { diffPixels, totalPixels, ratio: diffPixels / totalPixels };
}

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

describe("Flutter 화면 골든 이미지 테스트 (buildScreenIR → render → pixelmatch)", () => {
  for (const { id, device } of SCREENS) {
    it(
      `${id} (${device}): 골든과 diff ≤ 0.5%`,
      async () => {
        // 1. IR 생성
        const ir: IRDocument = await flutterAdapter.buildScreenIR(CTX, id);

        // 2. PNG 렌더
        mkdirSync(TMP_DIR, { recursive: true });
        const result = await renderScreenshot(ir, { device, outDir: TMP_DIR });

        // 3. 골든 비교 or 생성
        mkdirSync(GOLDENS_DIR, { recursive: true });
        const goldenName = `${id}_${device}.png`;
        const goldenPath = resolve(GOLDENS_DIR, goldenName);

        // UPDATE_GOLDENS=1: 골든 생성 또는 갱신 (로컬 전용)
        if (process.env["UPDATE_GOLDENS"] === "1") {
          writeFileSync(goldenPath, readFileSync(result.pngPath));
          return;
        }

        if (!existsSync(goldenPath)) {
          // CI 또는 일반 실행: 골든 없으면 FAIL
          throw new Error(
            `골든 파일이 없음: ${goldenPath}\n` +
            `UPDATE_GOLDENS=1 로 실행하여 골든을 생성하세요.`
          );
        }

        const actual = readPng(result.pngPath);
        const golden = readPng(goldenPath);
        const { diffPixels, totalPixels, ratio } = pixelDiffRatio(actual, golden);

        expect(
          ratio,
          `픽셀 diff ${diffPixels}/${totalPixels} (${(ratio * 100).toFixed(3)}%) > 임계치 0.5%`,
        ).toBeLessThanOrEqual(GOLDENS_THRESHOLD);
      },
      60_000,
    );
  }

  it(
    "동일 IR 2회 렌더 → diff 정확히 0 (결정론)",
    async () => {
      const ir: IRDocument = await flutterAdapter.buildScreenIR(CTX, "HomeScreen");

      mkdirSync(resolve(TMP_DIR, "a"), { recursive: true });
      mkdirSync(resolve(TMP_DIR, "b"), { recursive: true });

      const [r1, r2] = await Promise.all([
        renderScreenshot(ir, { device: "iphone-15", outDir: resolve(TMP_DIR, "a") }),
        renderScreenshot(ir, { device: "iphone-15", outDir: resolve(TMP_DIR, "b") }),
      ]);

      const img1 = readPng(r1.pngPath);
      const img2 = readPng(r2.pngPath);
      const { diffPixels } = pixelDiffRatio(img1, img2);

      expect(diffPixels, "두 렌더 결과가 동일해야 함 (diff=0)").toBe(0);
    },
    90_000,
  );
});
