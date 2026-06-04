/**
 * 골든 이미지 테스트
 * - 픽스처 → PNG → __goldens__/ 에 저장된 골든과 pixelmatch diff
 * - 임계치: 0.1% (전체 픽셀의 0.001 초과 시 실패)
 * - antialiasing 허용 (includeAA: true)
 * - 동일 입력 2회 렌더 → diff 0 (결정론 보장)
 *
 * 골든 갱신: scripts/generate-goldens.mjs 를 명시적으로 실행할 것.
 * 자동 갱신 금지.
 */

import { readFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, afterEach } from "vitest";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { IRDocument } from "@sfc/core";
import { renderScreenshot } from "../capture/capture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const GOLDENS_DIR = resolve(__dirname, "__goldens__");
const TMP_DIR = resolve(__dirname, "__golden_tmp__");

function loadFixture(name: string): IRDocument {
  const raw = readFileSync(resolve(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(raw) as IRDocument;
}

function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

function pixelDiffRatio(
  imgA: PNG,
  imgB: PNG,
  threshold = 0.1,
): { diffPixels: number; totalPixels: number; ratio: number } {
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(
      `Size mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`,
    );
  }
  const diffPixels = pixelmatch(imgA.data, imgB.data, undefined, imgA.width, imgA.height, {
    threshold,
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

const GOLDENS_THRESHOLD = 0.001; // 0.1%

const fixtures = [
  { file: "01-simple-column-text.json", device: "iphone-15" },
  { file: "02-nested-row-flex.json", device: "pixel-8" },
  { file: "03-stack-scroll.json", device: "iphone-15" },
  { file: "04-appbar-tabbar-safearea.json", device: "iphone-15" },
  { file: "05-tokens-unknown-branch.json", device: "pixel-8" },
];

describe("골든 이미지 테스트 — pixelmatch diff ≤ 0.1%", () => {
  for (const { file, device } of fixtures) {
    it(
      `${file} (${device}) 골든과 diff ≤ 0.1%`,
      async () => {
        const ir = loadFixture(file);
        mkdirSync(TMP_DIR, { recursive: true });
        const result = await renderScreenshot(ir, { device, outDir: TMP_DIR });

        const goldenName = `${ir.screen.id}_${device}.png`;
        const goldenPath = resolve(GOLDENS_DIR, goldenName);

        expect(
          existsSync(goldenPath),
          `골든 이미지가 없음: ${goldenPath}. scripts/generate-goldens.mjs를 실행하세요.`,
        ).toBe(true);

        const actual = readPng(result.pngPath);
        const golden = readPng(goldenPath);
        const { diffPixels, totalPixels, ratio } = pixelDiffRatio(actual, golden);

        expect(
          ratio,
          `픽셀 diff ${diffPixels}/${totalPixels} (${(ratio * 100).toFixed(3)}%) > 임계치 0.1%`,
        ).toBeLessThanOrEqual(GOLDENS_THRESHOLD);
      },
      30_000,
    );
  }

  it(
    "동일 입력 2회 렌더 → diff 정확히 0 (결정론)",
    async () => {
      const ir = loadFixture("01-simple-column-text.json");

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
    60_000,
  );
});
