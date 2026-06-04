import { execa } from "execa";
import type { CheckResult } from "./types.js";

export async function checkCocoaPods(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "cocoapods",
    label: "CocoaPods",
    autoInstallable: false,
    hint: "iOS/macOS 의존성 관리자입니다. `sudo gem install cocoapods` 또는 Homebrew: `brew install cocoapods`",
  };

  try {
    const { stdout } = await execa("pod", ["--version"]);
    const version = stdout.trim();

    if (!version) {
      return { ...base, status: "missing" };
    }

    return { ...base, status: "ok", version };
  } catch {
    return { ...base, status: "missing" };
  }
}
