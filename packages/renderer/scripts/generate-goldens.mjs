/**
 * 골든 PNG 생성 스크립트
 * 실행: node scripts/generate-goldens.mjs
 * 주의: 의도적 갱신 시에만 실행. CI에서는 자동 실행 금지.
 */
import { readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../src/__tests__/fixtures");
const GOLDENS_DIR = resolve(__dirname, "../src/__tests__/__goldens__");

mkdirSync(GOLDENS_DIR, { recursive: true });

// dist/ 빌드 후에만 동작
const { renderScreenshot } = await import("../dist/capture/capture.js");

const fixtures = [
  { file: "01-simple-column-text.json", device: "iphone-15" },
  { file: "02-nested-row-flex.json", device: "pixel-8" },
  { file: "03-stack-scroll.json", device: "iphone-15" },
  { file: "04-appbar-tabbar-safearea.json", device: "iphone-15" },
  { file: "05-tokens-unknown-branch.json", device: "pixel-8" },
];

for (const { file, device } of fixtures) {
  const ir = JSON.parse(readFileSync(resolve(FIXTURES_DIR, file), "utf-8"));
  const result = await renderScreenshot(ir, { device, outDir: GOLDENS_DIR });
  console.log(`Generated: ${result.pngPath} (${result.width}x${result.height})`);
}

console.log("Done. Goldens generated in:", GOLDENS_DIR);
