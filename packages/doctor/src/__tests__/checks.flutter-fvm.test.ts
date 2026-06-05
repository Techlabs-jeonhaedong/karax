/**
 * checkFlutter / checkDart의 FVM 인식 테스트
 *
 * 파일 시스템 기반 FVM resolve를 사용하므로 execa를 mock하되,
 * fvm-flutter 경로 존재 여부는 os.tmpdir() 임시 디렉토리로 격리한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// execa mock — 체크 모듈보다 먼저 선언
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { checkFlutter, checkDart } from "../checks/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

let tmpDir: string;

function writeFakeFlutter(flutterBinPath: string): void {
  fs.mkdirSync(path.dirname(flutterBinPath), { recursive: true });
  fs.writeFileSync(flutterBinPath, "#!/bin/sh\necho 'Flutter 3.19.0'\n");
  fs.chmodSync(flutterBinPath, 0o755);
}

function writeFakeDart(dartBinPath: string): void {
  fs.mkdirSync(path.dirname(dartBinPath), { recursive: true });
  fs.writeFileSync(dartBinPath, "#!/bin/sh\necho 'Dart SDK version: 3.2.0 (stable)'\n");
  fs.chmodSync(dartBinPath, 0o755);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-doctor-fvm-test-"));
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── checkFlutter FVM 인식 ─────────────────────────────────────────────────────

describe("checkFlutter — FVM 인식", () => {
  const FLUTTER_VERSION_OUT = [
    "Flutter 3.19.0 • channel stable",
    "Framework • revision abc123",
  ].join("\n");

  it("FVM SDK 경로가 존재할 때 해당 경로로 ok 판정한다", async () => {
    const projectPath = fs.mkdtempSync(path.join(tmpDir, "project-"));
    const cacheDir = path.join(tmpDir, "fvm-cache");

    // .fvmrc와 캐시에 flutter 준비
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    const fvmFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(fvmFlutter);

    // FVM 경로로 execa 호출 시 성공 응답
    mockExeca.mockResolvedValueOnce({
      stdout: FLUTTER_VERSION_OUT,
      stderr: FLUTTER_VERSION_OUT,
      exitCode: 0,
    });

    const result = await checkFlutter({
      projectPath,
      env: { FVM_CACHE_PATH: cacheDir },
    });

    expect(result.status).toBe("ok");
    expect(result.version).toBe("3.19.0");
    // FVM 경로로 execa가 호출됐는지 확인
    expect(mockExeca).toHaveBeenCalledWith(
      fvmFlutter,
      ["--version"],
      expect.any(Object)
    );
  });

  it("FVM 설정 없으면 기존 동작 유지 (PATH flutter 사용)", async () => {
    const projectPath = fs.mkdtempSync(path.join(tmpDir, "project-no-fvm-"));
    // .fvmrc 없음

    mockExeca.mockResolvedValueOnce({
      stdout: FLUTTER_VERSION_OUT,
      stderr: FLUTTER_VERSION_OUT,
      exitCode: 0,
    });

    const result = await checkFlutter({ projectPath });
    expect(result.status).toBe("ok");
    // PATH의 "flutter"로 호출
    expect(mockExeca).toHaveBeenCalledWith("flutter", ["--version"], expect.any(Object));
  });

  it("projectPath 없이 호출하면 기존 동작 유지", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: FLUTTER_VERSION_OUT,
      stderr: FLUTTER_VERSION_OUT,
      exitCode: 0,
    });

    const result = await checkFlutter();
    expect(result.status).toBe("ok");
    expect(mockExeca).toHaveBeenCalledWith("flutter", ["--version"], expect.any(Object));
  });
});

// ── checkDart FVM 인식 ────────────────────────────────────────────────────────

describe("checkDart — FVM SDK 내장 dart 인식", () => {
  const DART_VERSION_OUT = "Dart SDK version: 3.3.0 (stable) (Wed Mar 13 09:26:44 2024 +0000) on \"macos_arm64\"";

  it("FVM SDK 내장 dart 존재 시 해당 경로로 ok 판정한다", async () => {
    const projectPath = fs.mkdtempSync(path.join(tmpDir, "project-"));
    const cacheDir = path.join(tmpDir, "fvm-cache");

    // .fvmrc와 캐시에 flutter + dart 준비 (FVM SDK에는 bin/dart도 포함)
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    const fvmFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(fvmFlutter);
    // dart는 flutter와 같은 bin 디렉토리에 위치
    const fvmDart = path.join(cacheDir, "versions", "3.19.0", "bin", "dart");
    writeFakeDart(fvmDart);

    mockExeca.mockResolvedValueOnce({
      stdout: DART_VERSION_OUT,
      stderr: "",
      exitCode: 0,
    });

    const result = await checkDart({
      projectPath,
      env: { FVM_CACHE_PATH: cacheDir },
    });

    expect(result.status).toBe("ok");
    expect(result.version).toBe("3.3.0");
    // FVM dart 경로로 execa 호출 (PATH dart가 아닌 FVM dart 경로)
    const calledDartPath = mockExeca.mock.calls[0][0] as string;
    expect(calledDartPath).toContain("fvm-cache");
    expect(calledDartPath).toMatch(/bin[/\\]dart$/);
    expect(mockExeca.mock.calls[0][1]).toEqual(["--version"]);
  });

  it("FVM SDK에 flutter만 있고 dart 없으면 PATH dart로 fallback한다", async () => {
    const projectPath = fs.mkdtempSync(path.join(tmpDir, "project-"));
    const cacheDir = path.join(tmpDir, "fvm-cache");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    // flutter만 생성, dart 없음
    const fvmFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(fvmFlutter);

    mockExeca.mockResolvedValueOnce({
      stdout: DART_VERSION_OUT,
      stderr: "",
      exitCode: 0,
    });

    const result = await checkDart({
      projectPath,
      env: { FVM_CACHE_PATH: cacheDir },
    });

    expect(result.status).toBe("ok");
    // PATH dart로 fallback
    expect(mockExeca).toHaveBeenCalledWith("dart", ["--version"]);
  });

  it("projectPath 없이 호출하면 기존 동작 유지", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: DART_VERSION_OUT,
      stderr: "",
      exitCode: 0,
    });

    const result = await checkDart();
    expect(result.status).toBe("ok");
    expect(mockExeca).toHaveBeenCalledWith("dart", ["--version"]);
  });
});
