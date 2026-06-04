import { execa } from "execa";
import type { CheckResult } from "./types.js";

export async function checkPlaywrightChromium(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "playwright-chromium",
    label: "Playwright Chromium",
    autoInstallable: true,
    hint: "npx playwright install chromium 으로 자동 설치 가능합니다.",
  };

  try {
    const { stdout } = await execa("npx", ["playwright", "chromium-path"]);
    const path = stdout.trim();

    if (!path) {
      return { ...base, status: "missing" };
    }

    return { ...base, status: "ok", version: path };
  } catch {
    return { ...base, status: "missing" };
  }
}
