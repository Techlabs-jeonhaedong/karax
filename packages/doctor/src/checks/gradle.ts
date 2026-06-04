import { execa } from "execa";
import type { CheckResult } from "./types.js";

export async function checkGradle(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "gradle",
    label: "Gradle",
    autoInstallable: false,
    hint: "Gradle이 필요합니다. https://gradle.org/install 또는 Homebrew: brew install gradle",
  };

  try {
    // 콜드스타트가 느린 머신에서 30s+ 소요 가능 → timeout 30s
    const { stdout } = await execa("gradle", ["--version"], { timeout: 30_000 });
    // "Gradle 8.14.3" 형태 파싱
    const match = stdout.match(/Gradle\s+(\d+\.\d+(?:\.\d+)?)/);
    if (!match) {
      return { ...base, status: "missing" };
    }

    return { ...base, status: "ok", version: match[1] };
  } catch {
    return { ...base, status: "missing" };
  }
}
