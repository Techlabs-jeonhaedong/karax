/**
 * XML layout 화면 골든 이미지 테스트 (Tier 2 정적 렌더링)
 *
 * xml-layout-case fixture → buildXmlScreenIR → renderer → PNG
 * pixelmatch diff ≤ 0.5%
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
import { buildXmlScreenIR } from "../xml/xmlLayoutAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDENS_DIR = resolve(__dirname, "../../__goldens__");
const TMP_DIR = resolve(__dirname, "__xml_golden_tmp__");

const FIXTURE = resolve(__dirname, "fixtures/xml-layout-case");
const GOLDEN_THRESHOLD = 0.005; // 0.5%

const SCREENS = [
  { id: "activity_main", device: "pixel-8" as const },
];

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
  const diffPixels = pixelmatch(
    imgA.data,
    imgB.data,
    undefined,
    imgA.width,
    imgA.height,
    { threshold: 0.1, includeAA: true }
  );
  const totalPixels = imgA.width * imgA.height;
  return { diffPixels, totalPixels, ratio: diffPixels / totalPixels };
}

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

describe("XML layout 화면 골든 이미지 (Tier 2)", () => {
  for (const { id, device } of SCREENS) {
    it(`${id} @ ${device}`, async () => {
      const goldenPath = resolve(GOLDENS_DIR, `xml_${id}.png`);
      const tmpOutDir = resolve(TMP_DIR, id);
      mkdirSync(tmpOutDir, { recursive: true });

      // IR 빌드
      const doc = await buildXmlScreenIR(FIXTURE, id, 42);

      // 렌더링
      const { pngPath } = await renderScreenshot(doc, { device, outDir: tmpOutDir });

      if (process.env["UPDATE_GOLDENS"] === "1") {
        // 골든 갱신 모드
        mkdirSync(GOLDENS_DIR, { recursive: true });
        const pngData = readFileSync(pngPath);
        writeFileSync(goldenPath, pngData);
        console.log(`[golden] XML 갱신됨: ${goldenPath}`);
        return;
      }

      // 골든 비교 모드
      if (!existsSync(goldenPath)) {
        throw new Error(
          `XML 골든 이미지 없음: ${goldenPath}\n` +
            `생성하려면: UPDATE_GOLDENS=1 pnpm --filter @karax/adapter-android test`
        );
      }

      const goldenPng = readPng(goldenPath);
      const renderedPng = readPng(pngPath);
      const { ratio } = pixelDiffRatio(goldenPng, renderedPng);

      expect(ratio).toBeLessThanOrEqual(GOLDEN_THRESHOLD);
    }, 120_000);
  }
});
