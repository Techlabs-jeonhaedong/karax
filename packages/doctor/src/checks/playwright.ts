import type { CheckResult } from "./types.js";
import { getChromiumPath } from "../ensure.js";

export async function checkPlaywrightChromium(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "playwright-chromium",
    label: "Playwright Chromium",
    autoInstallable: true,
    hint: "npx playwright install chromium 으로 자동 설치 가능합니다.",
  };

  const chromiumPath = await getChromiumPath();

  if (!chromiumPath) {
    return { ...base, status: "missing" };
  }

  return { ...base, status: "ok", version: chromiumPath };
}
