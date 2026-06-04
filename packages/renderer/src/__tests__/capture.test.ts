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

  it(
    "overlay=confidence: __overlay.png가 별도 생성됨",
    async () => {
      // fixture 05는 Unknown(confidence=0.2), Branch(confidence=0.5), Slot(confidence=0.3) 보유
      const ir = loadFixture("05-tokens-unknown-branch.json");
      const result = await renderScreenshot(ir, {
        device: "iphone-15",
        outDir: TMP_OUT,
        overlay: "confidence",
      });

      expect(result.overlayPngPath).toBeDefined();
      expect(result.overlayPngPath).toMatch(/__overlay\.png$/);
      expect(existsSync(result.overlayPngPath!)).toBe(true);
    },
    60_000,
  );

  it(
    "overlay=confidence: 원본 PNG도 정상 생성됨",
    async () => {
      const ir = loadFixture("05-tokens-unknown-branch.json");
      const result = await renderScreenshot(ir, {
        device: "iphone-15",
        outDir: TMP_OUT,
        overlay: "confidence",
      });

      expect(existsSync(result.pngPath)).toBe(true);
    },
    60_000,
  );

  it(
    "overlay=confidence: 오버레이 PNG와 원본 PNG는 서로 다른 파일 경로",
    async () => {
      const ir = loadFixture("05-tokens-unknown-branch.json");
      const result = await renderScreenshot(ir, {
        device: "iphone-15",
        outDir: TMP_OUT,
        overlay: "confidence",
      });

      expect(result.pngPath).not.toBe(result.overlayPngPath);
    },
    60_000,
  );

  it(
    "overlay=confidence: 오버레이 PNG가 원본 PNG와 실제로 다름 (마킹이 그려졌음을 검증)",
    async () => {
      const { PNG } = await import("pngjs");
      const pixelmatch = (await import("pixelmatch")).default;

      // fixture 05: Unknown(conf=0.2), Slot(conf=0.3) 등 저신뢰 노드 다수
      const ir = loadFixture("05-tokens-unknown-branch.json");
      const result = await renderScreenshot(ir, {
        device: "iphone-15",
        outDir: TMP_OUT,
        overlay: "confidence",
      });

      const origBuf = readFileSync(result.pngPath);
      const overlayBuf = readFileSync(result.overlayPngPath!);

      const orig = PNG.sync.read(origBuf);
      const overlay = PNG.sync.read(overlayBuf);

      expect(orig.width).toBe(overlay.width);
      expect(orig.height).toBe(overlay.height);

      const diffPixels = pixelmatch(orig.data, overlay.data, undefined, orig.width, orig.height, {
        threshold: 0.1,
        includeAA: true,
      });

      // 저신뢰 노드에 테두리+라벨이 그려졌으므로 픽셀 차이가 반드시 존재해야 한다
      expect(diffPixels).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "overlay 미지정: overlayPngPath가 undefined",
    async () => {
      const ir = loadFixture("01-simple-column-text.json");
      const result = await renderScreenshot(ir, {
        device: "iphone-15",
        outDir: TMP_OUT,
      });

      expect(result.overlayPngPath).toBeUndefined();
    },
    60_000,
  );
});
