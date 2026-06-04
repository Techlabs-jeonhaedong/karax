import { execa } from "execa";
import type { CheckResult } from "./types.js";

const MIN_MAJOR = 20;

export async function checkNode(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "node",
    label: "Node.js",
    autoInstallable: false,
    hint: `Node.js >= ${MIN_MAJOR} 필요. https://nodejs.org 에서 설치하거나 nvm/fnm 사용 권장.`,
  };

  try {
    const { stdout } = await execa("node", ["--version"]);
    const raw = stdout.trim().replace(/^v/, "");
    const major = parseInt(raw.split(".")[0], 10);

    if (isNaN(major)) {
      return { ...base, status: "missing" };
    }

    if (major < MIN_MAJOR) {
      return { ...base, status: "outdated", version: raw };
    }

    return { ...base, status: "ok", version: raw };
  } catch {
    return { ...base, status: "missing" };
  }
}
