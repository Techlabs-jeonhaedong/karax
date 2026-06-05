/**
 * UIKit Storyboard 화면 골든 이미지 테스트 (Tier 2)
 * buildUIKitScreenIR(fixture) → renderer → pixelmatch diff ≤ 1%
 *
 * 골든 갱신: UPDATE_GOLDENS=1 vitest run
 */

import { readFileSync, existsSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, afterEach } from "vitest";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { renderScreenshot } from "@karax/renderer";
import { buildUIKitScreenIR } from "../legacy/storyboardParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDENS_DIR = resolve(__dirname, "../../__goldens__");
const TMP_DIR = resolve(__dirname, "__uikit_golden_tmp__");
const FIXTURE = resolve(__dirname, "fixtures/uikit-storyboard-case");

const GOLDENS_THRESHOLD = 0.01; // 1%

function readPng(p: string): PNG {
  return PNG.sync.read(readFileSync(p));
}

function pixelDiffRatio(
  imgA: PNG,
  imgB: PNG
): { diffPixels: number; totalPixels: number; ratio: number } {
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(
      `Size mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`
    );
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

describe("UIKit Storyboard 화면 골든 이미지 (Tier 2)", () => {
  it("HomeViewController @ iphone-15", async () => {
    const id = "HomeViewController";
    const device = "iphone-15" as const;
    const goldenPath = resolve(GOLDENS_DIR, `${id}.png`);
    const tmpOutDir = resolve(TMP_DIR, id);
    mkdirSync(tmpOutDir, { recursive: true });

    const doc = await buildUIKitScreenIR(FIXTURE, id);

    const { pngPath } = await renderScreenshot(doc, { device, outDir: tmpOutDir });

    if (process.env["UPDATE_GOLDENS"] === "1") {
      mkdirSync(GOLDENS_DIR, { recursive: true });
      const pngData = readFileSync(pngPath);
      writeFileSync(goldenPath, pngData);
      console.log(`[golden] 갱신됨: ${goldenPath}`);
      return;
    }

    if (!existsSync(goldenPath)) {
      throw new Error(
        `골든 이미지 없음: ${goldenPath}\n` +
          `생성하려면: UPDATE_GOLDENS=1 pnpm test --filter @karax/adapter-ios`
      );
    }

    const goldenPng = readPng(goldenPath);
    const renderedPng = readPng(pngPath);
    const { ratio } = pixelDiffRatio(goldenPng, renderedPng);

    expect(ratio).toBeLessThanOrEqual(GOLDENS_THRESHOLD);
  }, 60_000);
});
