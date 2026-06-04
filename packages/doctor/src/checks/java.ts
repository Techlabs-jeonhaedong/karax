import { execa } from "execa";
import type { CheckResult } from "./types.js";

const MIN_MAJOR = 11;

/**
 * Java 버전 파싱.
 * JDK 9 이상: 'openjdk version "17.0.15"'
 * JDK 8:      'openjdk version "1.8.0_392"' → major=8
 */
function parseJavaMajor(output: string): { major: number; full: string } | null {
  // "X.Y.Z" or "1.Y.Z" 형태
  const match = output.match(/"(\d+)\.(\d+)[._](\d+[^"]*)?"/);
  if (!match) return null;

  const first = parseInt(match[1], 10);
  const second = parseInt(match[2], 10);
  // JDK 8 이하는 1.X 형식
  const major = first === 1 ? second : first;
  const full = `${match[1]}.${match[2]}${match[3] ? `.${match[3]}` : ""}`;

  return { major, full };
}

export async function checkJava(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "java",
    label: "Java (JDK)",
    autoInstallable: false,
    hint: `JDK >= ${MIN_MAJOR} 필요. https://adoptium.net 또는 Homebrew: brew install openjdk@17`,
  };

  try {
    // java -version 은 stderr에 출력
    const { stdout, stderr } = await execa("java", ["-version"]);
    const output = stdout || stderr;

    const parsed = parseJavaMajor(output);
    if (!parsed) {
      return { ...base, status: "missing" };
    }

    if (parsed.major < MIN_MAJOR) {
      return { ...base, status: "outdated", version: parsed.full };
    }

    return { ...base, status: "ok", version: parsed.full };
  } catch {
    return { ...base, status: "missing" };
  }
}
