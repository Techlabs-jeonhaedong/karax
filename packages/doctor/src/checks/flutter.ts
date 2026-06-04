import { execa } from "execa";
import type { CheckResult } from "./types.js";

export async function checkFlutter(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "flutter",
    label: "Flutter SDK",
    autoInstallable: false,
    hint: "Flutter SDK를 설치하세요: https://docs.flutter.dev/get-started/install",
  };

  try {
    // flutter --version 은 stdout 대신 stderr에 출력하는 경우도 있음
    const { stdout, stderr } = await execa("flutter", ["--version"]);
    const output = stdout || stderr;

    // "Flutter 3.38.5 • channel stable" 형태 파싱
    const match = output.match(/Flutter\s+(\d+\.\d+\.\d+)/);
    if (!match) {
      return { ...base, status: "missing" };
    }

    return { ...base, status: "ok", version: match[1] };
  } catch {
    return { ...base, status: "missing" };
  }
}

export async function checkDart(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "dart",
    label: "Dart SDK",
    autoInstallable: false,
    hint: "Dart SDK는 Flutter SDK에 포함됩니다. https://dart.dev/get-dart",
  };

  try {
    const { stdout } = await execa("dart", ["--version"]);
    // "Dart SDK version: 3.10.4 (stable)" 형태 파싱
    const match = stdout.match(/Dart SDK version:\s+(\d+\.\d+\.\d+)/);
    if (!match) {
      return { ...base, status: "missing" };
    }

    return { ...base, status: "ok", version: match[1] };
  } catch {
    return { ...base, status: "missing" };
  }
}
