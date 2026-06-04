import { readFileSync, existsSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, afterEach } from "vitest";
import type { IRDocument } from "@sfc/core";
import { renderScreenshot } from "../capture/capture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): IRDocument {
  const raw = readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
  return JSON.parse(raw) as IRDocument;
}

const TMP_OUT = resolve(__dirname, "__tmp_capture__");

afterEach(() => {
  if (existsSync(TMP_OUT)) {
    rmSync(TMP_OUT, { recursive: true, force: true });
  }
});

describe("renderScreenshot — Playwright Chromium 캡처", () => {
  it(
    "01: PNG 파일이 생성됨",
    async () => {
      const ir = loadFixture("01-simple-column-text.json");
      const result = await renderScreenshot(ir, { device: "iphone-15", outDir: TMP_OUT });

      expect(result.pngPath).toMatch(/\.png$/);
      expect(existsSync(result.pngPath)).toBe(true);
    },
    60_000,
  );

  it(
    "01: PNG 크기가 디바이스 물리 해상도와 일치 (393x852 * dpr=3)",
    async () => {
      const ir = loadFixture("01-simple-column-text.json");
      const result = await renderScreenshot(ir, { device: "iphone-15", outDir: TMP_OUT });

      expect(result.width).toBe(393 * 3); // 1179
      expect(result.height).toBe(852 * 3); // 2556
    },
    60_000,
  );

  it(
    "02: pixel-8 디바이스 크기 반영",
    async () => {
      const ir = loadFixture("02-nested-row-flex.json");
      const result = await renderScreenshot(ir, { device: "pixel-8", outDir: TMP_OUT });

      expect(result.width).toBe(Math.round(412 * 2.625)); // 1081
      expect(result.height).toBe(Math.round(915 * 2.625)); // 2401
    },
    60_000,
  );

  it(
    "동일 입력 두 번 렌더 → pixelmatch diff 0 (결정론 테스트)",
    async () => {
      const { PNG } = await import("pngjs");
      const pixelmatch = (await import("pixelmatch")).default;

      const ir = loadFixture("01-simple-column-text.json");

      const r1 = await renderScreenshot(ir, { device: "iphone-15", outDir: TMP_OUT + "/run1" });
      const r2 = await renderScreenshot(ir, { device: "iphone-15", outDir: TMP_OUT + "/run2" });

      const buf1 = readFileSync(r1.pngPath);
      const buf2 = readFileSync(r2.pngPath);

      const img1 = PNG.sync.read(buf1);
      const img2 = PNG.sync.read(buf2);

      expect(img1.width).toBe(img2.width);
      expect(img1.height).toBe(img2.height);

      const diffPixels = pixelmatch(img1.data, img2.data, undefined, img1.width, img1.height, {
        threshold: 0.1,
        includeAA: true,
      });

      expect(diffPixels).toBe(0);
    },
    60_000,
  );

  it(
    "IR 없이 임의 IRDocument도 PNG 생성 가능",
    async () => {
      const ir: IRDocument = {
        schemaVersion: "0.1",
        screen: {
          id: "MinimalTest",
          discovery: "route",
          confidence: 1.0,
          root: {
            type: "Box",
            confidence: 1.0,
            style: { background: "#FF5722" },
            children: [
              {
                type: "Text",
                confidence: 1.0,
                text: { value: "Minimal", "color": "#FFFFFF" },
              },
            ],
          },
        },
        designTokens: {},
        diagnostics: [],
      };

      const result = await renderScreenshot(ir, { device: "iphone-15", outDir: TMP_OUT });
      expect(existsSync(result.pngPath)).toBe(true);
    },
    60_000,
  );
}, );
