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
    const { stdout } = await execa("gradle", ["--version"]);
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
