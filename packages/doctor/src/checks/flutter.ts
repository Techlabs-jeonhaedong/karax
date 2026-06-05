import { execa } from "execa";
import { resolveFlutterPath } from "@karax/adapter-api";
import * as path from "path";
import * as fs from "fs";
import type { CheckResult } from "./types.js";

export interface FlutterCheckOptions {
  /** 프로젝트 경로 — FVM SDK 감지에 사용 (optional) */
  projectPath?: string;
  /** 환경변수 오버라이드 (테스트용) */
  env?: Record<string, string | undefined>;
}

export async function checkFlutter(opts: FlutterCheckOptions = {}): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "flutter",
    label: "Flutter SDK",
    autoInstallable: false,
    hint: "Flutter SDK를 설치하세요: https://docs.flutter.dev/get-started/install",
  };

  // FVM SDK 경로 우선 시도
  const flutterExecutable = await resolveFlutterExecutable(opts);

  try {
    // flutter --version 은 stdout 대신 stderr에 출력하는 경우도 있음
    // 콜드스타트가 느린 머신에서 30s+ 소요 가능 → timeout 30s
    const { stdout, stderr } = await execa(flutterExecutable, ["--version"], { timeout: 30_000 });
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

export async function checkDart(opts: FlutterCheckOptions = {}): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint"> = {
    id: "dart",
    label: "Dart SDK",
    autoInstallable: false,
    hint: "Dart SDK는 Flutter SDK에 포함됩니다. https://dart.dev/get-dart",
  };

  // FVM SDK 내장 dart 우선 시도 (<sdk>/bin/dart)
  const dartExecutable = await resolveDartExecutable(opts);

  try {
    const { stdout } = await execa(dartExecutable, ["--version"]);
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

/** FVM 경로가 있으면 반환, 없으면 "flutter" (PATH fallback) */
async function resolveFlutterExecutable(opts: FlutterCheckOptions): Promise<string> {
  if (!opts.projectPath) return "flutter";
  try {
    const fvmPath = await resolveFlutterPath(opts.projectPath, opts.env ?? process.env);
    return fvmPath ?? "flutter";
  } catch {
    return "flutter";
  }
}

/** FVM SDK bin/dart가 존재하면 반환, 없으면 "dart" (PATH fallback) */
async function resolveDartExecutable(opts: FlutterCheckOptions): Promise<string> {
  if (!opts.projectPath) return "dart";
  try {
    const fvmFlutterPath = await resolveFlutterPath(opts.projectPath, opts.env ?? process.env);
    if (!fvmFlutterPath) return "dart";
    // FVM flutter 경로의 bin 디렉토리에서 dart를 탐색
    const dartPath = path.join(path.dirname(fvmFlutterPath), "dart");
    if (fs.existsSync(dartPath)) return dartPath;
    return "dart";
  } catch {
    return "dart";
  }
}
