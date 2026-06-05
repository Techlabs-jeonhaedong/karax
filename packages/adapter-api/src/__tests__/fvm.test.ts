/**
 * FVM(Flutter Version Manager) resolve 유틸 단위 테스트
 *
 * 테스트 픽스처는 os.tmpdir() 아래 임시 디렉토리에 생성해
 * fixtures/ 골든 테스트에 영향을 주지 않도록 격리한다.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveFlutterPath } from "../fvm.js";

let tmpDir: string;

function makeProjectDir(): string {
  const p = fs.mkdtempSync(path.join(tmpDir, "project-"));
  return p;
}

/** 실제 실행파일처럼 동작하는 더미 셸 스크립트 생성 */
function writeFakeFlutter(flutterBinPath: string): void {
  fs.mkdirSync(path.dirname(flutterBinPath), { recursive: true });
  fs.writeFileSync(flutterBinPath, "#!/bin/sh\necho 'Flutter 3.x.x'\n");
  fs.chmodSync(flutterBinPath, 0o755);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-fvm-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── .fvmrc (FVM 3.x) ──────────────────────────────────────────────────────────

describe("resolveFlutterPath — .fvmrc (FVM 3.x)", () => {
  it("심링크가 존재하면 심링크 경로(realpath)를 우선 반환한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    // .fvmrc 생성
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));

    // 캐시 내부에 실제 바이너리 생성 후 심링크로 연결 (실제 FVM 동작 모사)
    const realFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(realFlutter);
    const symlinkDir = path.join(projectPath, ".fvm", "flutter_sdk", "bin");
    fs.mkdirSync(symlinkDir, { recursive: true });
    const symlinkBin = path.join(symlinkDir, "flutter");
    fs.symlinkSync(realFlutter, symlinkBin);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    // realpath로 정규화된 경로 반환
    expect(result).toBe(fs.realpathSync(realFlutter));
  });

  it("심링크 없고 FVM_CACHE_PATH 캐시에 SDK가 있으면 캐시 경로를 반환한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    // .fvm/flutter_sdk 없음

    // 캐시 경로에 flutter 실행파일 생성
    const cachedFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    expect(result).toBe(cachedFlutter);
  });

  it("FVM_CACHE_PATH가 없으면 기본 ~/fvm/versions/<ver>/bin/flutter를 시도한다", async () => {
    const projectPath = makeProjectDir();
    const homeDir = path.join(tmpDir, "home");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.22.0" }));

    const cachedFlutter = path.join(homeDir, "fvm", "versions", "3.22.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    // HOME을 tmpDir 하위로 변경해 기본 경로를 제어
    const result = await resolveFlutterPath(projectPath, {}, homeDir);
    expect(result).toBe(cachedFlutter);
  });

  it(".fvmrc가 있으나 심링크·캐시 모두 없으면 null을 반환한다 (PATH fallback은 호출자 책임)", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.99.0" }));
    // 캐시 없음

    const result = await resolveFlutterPath(projectPath, {}, path.join(tmpDir, "nonexistent-home"));
    expect(result).toBeNull();
  });
});

// ── .fvm/fvm_config.json (FVM 2.x) ────────────────────────────────────────────

describe("resolveFlutterPath — .fvm/fvm_config.json (FVM 2.x)", () => {
  it("FVM 2.x config 존재 시 캐시 경로를 반환한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    fs.mkdirSync(path.join(projectPath, ".fvm"), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, ".fvm", "fvm_config.json"),
      JSON.stringify({ flutterSdkVersion: "3.10.0" })
    );

    const cachedFlutter = path.join(cacheDir, "versions", "3.10.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    const result = await resolveFlutterPath(projectPath, { FVM_HOME: cacheDir });
    expect(result).toBe(cachedFlutter);
  });

  it("FVM 2.x에서 FVM_HOME 환경변수가 없으면 기본 경로를 사용한다", async () => {
    const projectPath = makeProjectDir();
    const homeDir = path.join(tmpDir, "home");

    fs.mkdirSync(path.join(projectPath, ".fvm"), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, ".fvm", "fvm_config.json"),
      JSON.stringify({ flutterSdkVersion: "3.10.0" })
    );

    const cachedFlutter = path.join(homeDir, "fvm", "versions", "3.10.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    const result = await resolveFlutterPath(projectPath, {}, homeDir);
    expect(result).toBe(cachedFlutter);
  });
});

// ── 우선순위: .fvmrc와 .fvm/fvm_config.json 공존 ──────────────────────────────

describe("resolveFlutterPath — 우선순위", () => {
  it(".fvmrc가 .fvm/fvm_config.json보다 우선한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    fs.mkdirSync(path.join(projectPath, ".fvm"), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, ".fvm", "fvm_config.json"),
      JSON.stringify({ flutterSdkVersion: "3.10.0" })
    );

    // 3.19.0 SDK만 캐시에 있음
    const cachedFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    expect(result).toBe(cachedFlutter);
  });

  it("심링크가 있으면 캐시 경로보다 우선한다 (realpath 반환)", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));

    // 캐시 내부에 실제 바이너리 생성 후 심링크로 연결 + 캐시 경로도 생성
    const cachedFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);
    const symlinkDir = path.join(projectPath, ".fvm", "flutter_sdk", "bin");
    fs.mkdirSync(symlinkDir, { recursive: true });
    const symlinkBin = path.join(symlinkDir, "flutter");
    fs.symlinkSync(cachedFlutter, symlinkBin);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    // 심링크가 캐시 내부를 가리키므로 realpath(캐시 경로) 반환
    expect(result).toBe(fs.realpathSync(cachedFlutter));
  });
});

// ── FVM_CACHE_PATH 환경변수 오버라이드 ───────────────────────────────────────

describe("resolveFlutterPath — FVM_CACHE_PATH 환경변수", () => {
  it("FVM_CACHE_PATH를 사용하면 기본 경로 대신 해당 경로를 사용한다", async () => {
    const projectPath = makeProjectDir();
    const customCache = path.join(tmpDir, "custom-fvm");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));

    // 기본 경로에는 SDK 없음, 커스텀 경로에만 있음
    const cachedFlutter = path.join(customCache, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: customCache });
    expect(result).toBe(cachedFlutter);
  });

  it("FVM_HOME(2.x 스타일)이 FVM_CACHE_PATH보다 낮은 우선순위를 가진다", async () => {
    const projectPath = makeProjectDir();
    const cachePathDir = path.join(tmpDir, "cache-path");
    const homeDir = path.join(tmpDir, "home-dir");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));

    const fvmCacheFlutter = path.join(cachePathDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(fvmCacheFlutter);

    const fvmHomeFlutter = path.join(homeDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(fvmHomeFlutter);

    const result = await resolveFlutterPath(projectPath, {
      FVM_CACHE_PATH: cachePathDir,
      FVM_HOME: homeDir,
    });
    // FVM_CACHE_PATH가 FVM_HOME보다 우선
    expect(result).toBe(fvmCacheFlutter);
  });
});

// ── FVM 설정 없음 ─────────────────────────────────────────────────────────────

describe("resolveFlutterPath — FVM 설정 없음", () => {
  it("FVM 설정 파일이 없으면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    // 아무 설정 파일도 없음

    const result = await resolveFlutterPath(projectPath);
    expect(result).toBeNull();
  });
});

// ── [보안-높음 1] version 문자열 path traversal 방지 ─────────────────────────

describe("resolveFlutterPath — version path traversal 방지", () => {
  it("버전 값에 ../ 경로 탐색 패턴이 있으면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(
      path.join(projectPath, ".fvmrc"),
      JSON.stringify({ flutter: "../../../bin/sh" })
    );
    const result = await resolveFlutterPath(projectPath, {}, path.join(tmpDir, "home"));
    expect(result).toBeNull();
  });

  it("버전 값이 절대경로이면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(
      path.join(projectPath, ".fvmrc"),
      JSON.stringify({ flutter: "/etc/passwd" })
    );
    const result = await resolveFlutterPath(projectPath, {}, path.join(tmpDir, "home"));
    expect(result).toBeNull();
  });

  it("버전 값에 윈도우 스타일 경로 탐색이 있으면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(
      path.join(projectPath, ".fvmrc"),
      JSON.stringify({ flutter: "..\\evil" })
    );
    const result = await resolveFlutterPath(projectPath, {}, path.join(tmpDir, "home"));
    expect(result).toBeNull();
  });

  it("버전 값에 .. 세그먼트가 포함된 복합 경로이면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(
      path.join(projectPath, ".fvmrc"),
      JSON.stringify({ flutter: "3.19.0/../evil" })
    );
    const result = await resolveFlutterPath(projectPath, {}, path.join(tmpDir, "home"));
    expect(result).toBeNull();
  });

  it("정상 버전 3.19.0은 통과한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    const cachedFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);
    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    expect(result).toBe(cachedFlutter);
  });

  it("정상 버전 stable은 통과한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "stable" }));
    const cachedFlutter = path.join(cacheDir, "versions", "stable", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);
    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    expect(result).toBe(cachedFlutter);
  });

  it("정상 버전 3.22.0-1.0.pre는 통과한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.22.0-1.0.pre" }));
    const cachedFlutter = path.join(cacheDir, "versions", "3.22.0-1.0.pre", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);
    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    expect(result).toBe(cachedFlutter);
  });
});

// ── [보안-높음 2] 심링크 realpath 경계 검증 ──────────────────────────────────

describe("resolveFlutterPath — 심링크 realpath 경계 검증", () => {
  it("캐시 내부를 가리키는 심링크는 정규화된 경로를 반환한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    // 캐시 내부에 실제 flutter 바이너리 생성
    const realFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(realFlutter);

    // 심링크 디렉토리 생성 후 심링크 연결
    const symlinkDir = path.join(projectPath, ".fvm", "flutter_sdk", "bin");
    fs.mkdirSync(symlinkDir, { recursive: true });
    const symlinkPath = path.join(symlinkDir, "flutter");
    fs.symlinkSync(realFlutter, symlinkPath);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    // realpath로 정규화된 경로 반환 (macOS /tmp → /private/tmp 처리)
    expect(result).toBe(fs.realpathSync(realFlutter));
  });

  it("캐시 밖을 가리키는 심링크는 무시하고 설정 기반으로 fallback한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    // /tmp 하위의 "악의적인" 바이너리 (캐시 밖)
    const outsideDir = path.join(tmpDir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFlutter = path.join(outsideDir, "flutter");
    writeFakeFlutter(outsideFlutter);

    // 심링크가 캐시 밖을 가리킴
    const symlinkDir = path.join(projectPath, ".fvm", "flutter_sdk", "bin");
    fs.mkdirSync(symlinkDir, { recursive: true });
    const symlinkPath = path.join(symlinkDir, "flutter");
    fs.symlinkSync(outsideFlutter, symlinkPath);

    // .fvmrc로 설정 기반 resolve 경로 준비
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    const cachedFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    // 심링크 무시 → 설정 기반 캐시 경로 반환
    expect(result).toBe(cachedFlutter);
  });

  it("깨진 심링크는 fallback하고 설정 기반 경로를 반환한다", async () => {
    const projectPath = makeProjectDir();
    const cacheDir = path.join(tmpDir, "fvm-cache");

    // 존재하지 않는 파일을 가리키는 심링크
    const symlinkDir = path.join(projectPath, ".fvm", "flutter_sdk", "bin");
    fs.mkdirSync(symlinkDir, { recursive: true });
    const symlinkPath = path.join(symlinkDir, "flutter");
    fs.symlinkSync("/nonexistent/path/flutter", symlinkPath);

    // 설정 기반 캐시 경로 준비
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    const cachedFlutter = path.join(cacheDir, "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    const result = await resolveFlutterPath(projectPath, { FVM_CACHE_PATH: cacheDir });
    // 깨진 심링크 무시 → 설정 기반 반환
    expect(result).toBe(cachedFlutter);
  });
});

// ── [보안-중간] FVM_CACHE_PATH / FVM_HOME 절대경로 검증 ──────────────────────

describe("resolveFlutterPath — 환경변수 절대경로 검증", () => {
  it("FVM_CACHE_PATH가 상대경로이면 무시하고 기본 ~/fvm를 사용한다", async () => {
    const projectPath = makeProjectDir();
    const homeDir = path.join(tmpDir, "home");

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.19.0" }));
    const cachedFlutter = path.join(homeDir, "fvm", "versions", "3.19.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    // 상대경로 FVM_CACHE_PATH — 무시되어야 함
    const result = await resolveFlutterPath(
      projectPath,
      { FVM_CACHE_PATH: "relative/path/fvm" },
      homeDir
    );
    expect(result).toBe(cachedFlutter);
  });

  it("FVM_HOME이 상대경로이면 무시하고 기본 ~/fvm를 사용한다", async () => {
    const projectPath = makeProjectDir();
    const homeDir = path.join(tmpDir, "home");

    fs.mkdirSync(path.join(projectPath, ".fvm"), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, ".fvm", "fvm_config.json"),
      JSON.stringify({ flutterSdkVersion: "3.10.0" })
    );
    const cachedFlutter = path.join(homeDir, "fvm", "versions", "3.10.0", "bin", "flutter");
    writeFakeFlutter(cachedFlutter);

    // 상대경로 FVM_HOME — 무시되어야 함
    const result = await resolveFlutterPath(
      projectPath,
      { FVM_HOME: "relative/fvm-home" },
      homeDir
    );
    expect(result).toBe(cachedFlutter);
  });
});

// ── 예외 케이스 ───────────────────────────────────────────────────────────────

describe("resolveFlutterPath — 예외 케이스", () => {
  it("깨진 JSON .fvmrc이면 null을 반환한다 (fallback)", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), "{ invalid json !!!");

    const result = await resolveFlutterPath(projectPath);
    expect(result).toBeNull();
  });

  it("깨진 JSON .fvm/fvm_config.json이면 null을 반환한다 (fallback)", async () => {
    const projectPath = makeProjectDir();
    fs.mkdirSync(path.join(projectPath, ".fvm"), { recursive: true });
    fs.writeFileSync(path.join(projectPath, ".fvm", "fvm_config.json"), "NOT_JSON");

    const result = await resolveFlutterPath(projectPath);
    expect(result).toBeNull();
  });

  it(".fvmrc에 flutter 버전이 비어있으면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "" }));

    const result = await resolveFlutterPath(projectPath);
    expect(result).toBeNull();
  });

  it("버전이 있는데 캐시에 SDK가 없으면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    const homeDir = path.join(tmpDir, "empty-home");
    fs.mkdirSync(homeDir);

    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ flutter: "3.99.999" }));
    // 캐시 없음

    const result = await resolveFlutterPath(projectPath, {}, homeDir);
    expect(result).toBeNull();
  });

  it("projectPath가 존재하지 않아도 에러를 던지지 않고 null을 반환한다", async () => {
    const result = await resolveFlutterPath("/nonexistent/path/xyz");
    expect(result).toBeNull();
  });

  it(".fvmrc에 flutter 필드가 없으면 null을 반환한다", async () => {
    const projectPath = makeProjectDir();
    fs.writeFileSync(path.join(projectPath, ".fvmrc"), JSON.stringify({ channel: "stable" }));

    const result = await resolveFlutterPath(projectPath);
    expect(result).toBeNull();
  });
});
