import { mkdirSync } from "fs";
import { resolve } from "path";
import type { IRDocument } from "@sfc/core";
import { getDeviceProfile } from "../devices/profiles.js";
import { irToHtml } from "../html/irToHtml.js";

export interface RenderOptions {
  /** 디바이스 프로파일 ID (기본: "iphone-15") */
  device?: string;
  /** PNG 출력 디렉토리 */
  outDir: string;
}

export interface RenderResult {
  /** 생성된 PNG 절대 경로 */
  pngPath: string;
  /** 물리 픽셀 너비 */
  width: number;
  /** 물리 픽셀 높이 */
  height: number;
}

export async function renderScreenshot(
  ir: IRDocument,
  options: RenderOptions,
): Promise<RenderResult> {
  const deviceId = options.device ?? ir.screen.device ?? "iphone-15";
  const profile = getDeviceProfile(deviceId);
  const html = irToHtml(ir, profile);

  const { chromium } = await import("playwright");

  mkdirSync(options.outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: {
        width: profile.width,
        height: profile.height,
      },
      deviceScaleFactor: profile.deviceScaleFactor,
    });

    const page = await context.newPage();

    await page.setContent(html, { waitUntil: "networkidle" });

    const pngFilename = `${ir.screen.id}_${deviceId}.png`;
    const pngPath = resolve(options.outDir, pngFilename);

    await page.screenshot({
      path: pngPath,
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: profile.width,
        height: profile.height,
      },
    });

    await context.close();

    const physicalWidth = Math.round(profile.width * profile.deviceScaleFactor);
    const physicalHeight = Math.round(profile.height * profile.deviceScaleFactor);

    return { pngPath, width: physicalWidth, height: physicalHeight };
  } finally {
    await browser.close();
  }
}
