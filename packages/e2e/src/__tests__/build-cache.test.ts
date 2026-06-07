/**
 * build/cache.ts 단위 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// fs mock — 파일시스템 조작 없이 단위 테스트
vi.mock("fs");
const mockFs = vi.mocked(fs);

// crypto mock — sha256 결정론 테스트
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return actual; // 실제 crypto 사용 (sha256은 순수 함수)
});

// os.tmpdir mock
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    tmpdir: vi.fn().mockReturnValue("/tmp"),
  };
});

import {
  computeSourceFingerprint,
  isArtifactFresh,
  readBuildCache,
  writeBuildCache,
  type CacheEntry,
  type SourceFingerprint,
} from "../build/cache.js";

// ── fixtures ───────────────────────────────────────────────────────

function makeFakeDirent(name: string, isDir: boolean): fs.Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: "",
    parentPath: "",
  } as unknown as fs.Dirent;
}

function makeStatResult(size: number, mtimeMs: number): fs.Stats {
  return {
    size,
    mtimeMs,
    isFile: () => true,
    isDirectory: () => false,
  } as unknown as fs.Stats;
}

beforeEach(() => {
  vi.clearAllMocks();
  // realpathSync 기본: throw → getCacheFilePath가 path.resolve 폴백 사용
  mockFs.realpathSync.mockImplementation((p: unknown) => String(p));
});

// ── computeSourceFingerprint ────────────────────────────────────────

describe("computeSourceFingerprint", () => {
  it("flutter 프로젝트에서 lib/+pubspec.yaml 파일을 읽어 hash를 반환한다", () => {
    // existsSync: lib 디렉토리 존재, pubspec.yaml 존재
    mockFs.existsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s.endsWith("/lib") || s.endsWith("pubspec.yaml");
    });

    // lib/ 디렉토리 readdirSync (withFileTypes: true)
    mockFs.readdirSync.mockReturnValueOnce([
      makeFakeDirent("main.dart", false),
    ] as unknown as fs.Dirent[]);

    // lib/main.dart stat, pubspec.yaml stat
    mockFs.statSync
      .mockReturnValueOnce(makeStatResult(1000, 1000)) // lib/main.dart
      .mockReturnValueOnce(makeStatResult(500, 2000)); // pubspec.yaml

    const fp = computeSourceFingerprint("/project", "flutter");

    expect(fp.hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(fp.newestSourceMtimeMs).toBe(2000);
  });

  it("빌드 산출물 디렉토리(build/ .gradle/ Pods/ node_modules/)는 제외된다", () => {
    // lib/ 존재, pubspec.yaml 존재
    mockFs.existsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s.endsWith("/lib") || s.endsWith("pubspec.yaml");
    });

    // lib/ 안에 build/, node_modules/ 같은 제외 대상 + 실제 파일
    mockFs.readdirSync.mockReturnValueOnce([
      makeFakeDirent("build", true),
      makeFakeDirent("node_modules", true),
      makeFakeDirent("main.dart", false),
    ] as unknown as fs.Dirent[]);

    mockFs.statSync
      .mockReturnValueOnce(makeStatResult(100, 1000)) // lib/main.dart
      .mockReturnValueOnce(makeStatResult(200, 1500)); // pubspec.yaml

    const fp = computeSourceFingerprint("/project", "flutter");
    // build/, node_modules/ 하위는 재귀 안 들어가므로 lib/main.dart + pubspec.yaml = 2 stat 호출
    expect(mockFs.statSync).toHaveBeenCalledTimes(2);
    expect(fp.hash).toBeTruthy();
  });

  it("파일 순서가 달라도 같은 파일이면 같은 hash를 반환한다 (정렬 결정론)", () => {
    // pubspec.yaml 없이 lib/만 사용 — statSync 호출 순서 단순화
    mockFs.existsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s.endsWith("/lib");
      // pubspec.yaml은 없음으로 처리
    });

    // 첫 번째 호출: b.dart, a.dart 순서
    mockFs.readdirSync.mockReturnValueOnce([
      makeFakeDirent("b.dart", false),
      makeFakeDirent("a.dart", false),
    ] as unknown as fs.Dirent[]);
    // b.dart stat → a.dart stat
    mockFs.statSync
      .mockReturnValueOnce(makeStatResult(100, 1000))
      .mockReturnValueOnce(makeStatResult(200, 2000));

    const fp1 = computeSourceFingerprint("/project", "flutter");
    vi.clearAllMocks();

    // 두 번째 호출: a.dart, b.dart 순서 (순서 반전)
    mockFs.existsSync.mockImplementation((p: unknown) => String(p).endsWith("/lib"));
    mockFs.readdirSync.mockReturnValueOnce([
      makeFakeDirent("a.dart", false),
      makeFakeDirent("b.dart", false),
    ] as unknown as fs.Dirent[]);
    // a.dart stat → b.dart stat
    mockFs.statSync
      .mockReturnValueOnce(makeStatResult(200, 2000))
      .mockReturnValueOnce(makeStatResult(100, 1000));

    const fp2 = computeSourceFingerprint("/project", "flutter");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("파일 내용(size)이 변경되면 hash가 달라진다", () => {
    mockFs.existsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s.endsWith("/lib") || s.endsWith("pubspec.yaml");
    });

    // 원본
    mockFs.readdirSync.mockReturnValueOnce([makeFakeDirent("main.dart", false)] as unknown as fs.Dirent[]);
    mockFs.statSync
      .mockReturnValueOnce(makeStatResult(100, 1000)) // lib/main.dart
      .mockReturnValueOnce(makeStatResult(300, 3000)); // pubspec.yaml
    const fp1 = computeSourceFingerprint("/project", "flutter");
    vi.clearAllMocks();

    // size 변경
    mockFs.existsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s.endsWith("/lib") || s.endsWith("pubspec.yaml");
    });
    mockFs.readdirSync.mockReturnValueOnce([makeFakeDirent("main.dart", false)] as unknown as fs.Dirent[]);
    mockFs.statSync
      .mockReturnValueOnce(makeStatResult(999, 1000)) // size 변경
      .mockReturnValueOnce(makeStatResult(300, 3000));
    const fp2 = computeSourceFingerprint("/project", "flutter");

    expect(fp1.hash).not.toBe(fp2.hash);
  });

  it("파일 수 상한(20000) 초과 시 sha256 hash를 반환한다 (overflow 경로)", () => {
    // lib/ 존재, pubspec.yaml 없음 (단순화)
    mockFs.existsSync.mockImplementation((p: unknown) => String(p).endsWith("/lib"));

    // lib/ 아래 20001개 파일 시뮬레이션
    const manyFiles = Array.from({ length: 20001 }, (_, i) =>
      makeFakeDirent(`file${i}.dart`, false)
    );
    mockFs.readdirSync.mockReturnValueOnce(manyFiles as unknown as fs.Dirent[]);
    mockFs.statSync.mockReturnValue(makeStatResult(100, 1000) as fs.Stats);

    const fp = computeSourceFingerprint("/project", "flutter");

    expect(fp.hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(fp.newestSourceMtimeMs).toBe(0);
  });

  it("overflow 케이스 — buildCommand가 있으면 없을 때와 hash가 달라진다", () => {
    // lib/ 아래 20001개 파일 → overflow
    mockFs.existsSync.mockImplementation((p: unknown) => String(p).endsWith("/lib"));
    const manyFiles = Array.from({ length: 20001 }, (_, i) =>
      makeFakeDirent(`file${i}.dart`, false)
    );
    mockFs.readdirSync.mockReturnValueOnce(manyFiles as unknown as fs.Dirent[]);
    mockFs.statSync.mockReturnValue(makeStatResult(100, 1000) as fs.Stats);
    const fpNoCmd = computeSourceFingerprint("/project", "flutter");

    vi.clearAllMocks();
    mockFs.existsSync.mockImplementation((p: unknown) => String(p).endsWith("/lib"));
    mockFs.readdirSync.mockReturnValueOnce(manyFiles as unknown as fs.Dirent[]);
    mockFs.statSync.mockReturnValue(makeStatResult(100, 1000) as fs.Stats);
    const fpWithCmd = computeSourceFingerprint("/project", "flutter", { buildCommand: "fvm flutter build apk" });

    expect(fpNoCmd.hash).not.toBe(fpWithCmd.hash);
  });

  it("overflow 케이스 — buildCommand 미지정 시 기존 hash와 동일하다 (하위 호환)", () => {
    // 두 번 모두 buildCommand 없음 → 같은 hash
    mockFs.existsSync.mockImplementation((p: unknown) => String(p).endsWith("/lib"));
    const manyFiles = Array.from({ length: 20001 }, (_, i) =>
      makeFakeDirent(`file${i}.dart`, false)
    );
    mockFs.readdirSync.mockReturnValueOnce(manyFiles as unknown as fs.Dirent[]);
    mockFs.statSync.mockReturnValue(makeStatResult(100, 1000) as fs.Stats);
    const fp1 = computeSourceFingerprint("/project", "flutter");

    vi.clearAllMocks();
    mockFs.existsSync.mockImplementation((p: unknown) => String(p).endsWith("/lib"));
    mockFs.readdirSync.mockReturnValueOnce(manyFiles as unknown as fs.Dirent[]);
    mockFs.statSync.mockReturnValue(makeStatResult(100, 1000) as fs.Stats);
    const fp2 = computeSourceFingerprint("/project", "flutter");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("empty 케이스 — buildCommand가 있으면 없을 때와 hash가 달라진다", () => {
    mockFs.existsSync.mockReturnValue(false);
    const fpNoCmd = computeSourceFingerprint("/project", "flutter");

    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    const fpWithCmd = computeSourceFingerprint("/project", "flutter", { buildCommand: "fvm flutter build apk" });

    expect(fpNoCmd.hash).not.toBe(fpWithCmd.hash);
  });

  it("empty 케이스 — buildCommand 미지정 시 기존 hash와 동일하다 (하위 호환)", () => {
    mockFs.existsSync.mockReturnValue(false);
    const fp1 = computeSourceFingerprint("/project", "flutter");

    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    const fp2 = computeSourceFingerprint("/project", "flutter");

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("소스 파일 없이 빈 프로젝트도 hash를 반환한다", () => {
    mockFs.existsSync.mockReturnValue(false);

    const fp = computeSourceFingerprint("/project", "flutter");

    expect(fp.hash).toBeTruthy();
    expect(fp.newestSourceMtimeMs).toBe(0);
  });
});

// ── isArtifactFresh ─────────────────────────────────────────────────

describe("isArtifactFresh", () => {
  it("artifact가 존재하고 mtime이 newestSourceMtimeMs보다 크면 true", () => {
    // existsSync: 항상 true 반환
    mockFs.existsSync.mockReturnValue(true);
    // statSync: artifact의 stat 반환 (mtime > newestSourceMtimeMs)
    mockFs.statSync.mockReturnValue({
      mtimeMs: 5000,
      isFile: () => true,
      isDirectory: () => false,
    } as unknown as fs.Stats);

    const fp: SourceFingerprint = { hash: "abc", newestSourceMtimeMs: 4000 };
    expect(isArtifactFresh("/tmp/app.apk", fp)).toBe(true);
  });

  it("artifact가 존재하지 않으면 false", () => {
    mockFs.existsSync.mockReturnValue(false);

    const fp: SourceFingerprint = { hash: "abc", newestSourceMtimeMs: 4000 };
    expect(isArtifactFresh("/tmp/app.apk", fp)).toBe(false);
  });

  it("artifact mtime이 newestSourceMtimeMs와 같으면 false (소스와 동시 변경 → 재빌드)", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({
      mtimeMs: 4000,
      isFile: () => true,
    } as unknown as fs.Stats);

    const fp: SourceFingerprint = { hash: "abc", newestSourceMtimeMs: 4000 };
    expect(isArtifactFresh("/tmp/app.apk", fp)).toBe(false);
  });

  it("artifact mtime이 newestSourceMtimeMs보다 작으면 false", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({
      mtimeMs: 3000,
      isFile: () => true,
    } as unknown as fs.Stats);

    const fp: SourceFingerprint = { hash: "abc", newestSourceMtimeMs: 4000 };
    expect(isArtifactFresh("/tmp/app.apk", fp)).toBe(false);
  });

  it("statSync가 throws하면 false (artifact 접근 불가)", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockImplementation(() => { throw new Error("EACCES"); });

    const fp: SourceFingerprint = { hash: "abc", newestSourceMtimeMs: 4000 };
    expect(isArtifactFresh("/tmp/app.apk", fp)).toBe(false);
  });
});

// ── readBuildCache / writeBuildCache round-trip ──────────────────────

describe("readBuildCache / writeBuildCache", () => {
  it("writeBuildCache → readBuildCache 라운드트립이 동일 항목을 반환한다", () => {
    const entry: CacheEntry = {
      // artifactPath가 projectPath(/project) 하위에 있으면 allowedRoots 검사 통과
      artifactPath: "/project/build/app.apk",
      appId: "com.example.app",
      sourceHash: "abc123",
      builtAtMs: 99999,
    };

    let storedJson = "";
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockImplementation((_p, data) => {
      storedJson = String(data);
    });
    mockFs.readFileSync.mockImplementation(() => storedJson);
    mockFs.existsSync.mockReturnValue(true);
    // realpathSync: 경로를 그대로 반환 (심볼릭 링크 없음으로 가정)
    mockFs.realpathSync.mockImplementation((p: unknown) => String(p));

    writeBuildCache("/project", "android", entry);
    const read = readBuildCache("/project", "android");

    expect(read).toEqual(entry);
  });

  it("캐시 파일이 없으면 null을 반환한다", () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = readBuildCache("/project", "android");
    expect(result).toBeNull();
  });

  it("손상된 JSON이면 null을 반환한다 (graceful 처리)", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("{invalid json{{");

    const result = readBuildCache("/project", "android");
    expect(result).toBeNull();
  });

  it("필수 필드가 빠진 JSON이면 null을 반환한다", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ artifactPath: "/tmp/app.apk" })); // 나머지 필드 없음

    const result = readBuildCache("/project", "android");
    expect(result).toBeNull();
  });

  it("캐시 파일 경로는 os.tmpdir()/karax-e2e-cache/ 아래에 생성된다", () => {
    const entry: CacheEntry = {
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "abc",
      builtAtMs: 0,
    };

    let writtenPath = "";
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockImplementation((p) => {
      writtenPath = String(p);
    });

    writeBuildCache("/my/project", "android", entry);

    expect(writtenPath).toMatch(/karax-e2e-cache/);
    expect(writtenPath).toMatch(/android\.json$/);
  });

  // ── 캐시 포이즈닝 방어 ──────────────────────────────────────────────

  it("artifactPath가 상대경로이면 null을 반환한다 (캐시 포이즈닝 방어)", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      artifactPath: "../../etc/passwd", // 상대경로 공격
      appId: "com.example.app",
      sourceHash: "abc",
      builtAtMs: 0,
    }));

    const result = readBuildCache("/project", "android");
    expect(result).toBeNull();
  });

  it("writeBuildCache가 0o600 모드로 파일을 쓴다", () => {
    const entry: CacheEntry = {
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "abc",
      builtAtMs: 0,
    };

    let writtenOpts: unknown;
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockImplementation((_p, _data, opts) => {
      writtenOpts = opts;
    });

    writeBuildCache("/my/project", "android", entry);

    expect(writtenOpts).toMatchObject({ mode: 0o600 });
  });

  it("writeBuildCache가 0o700 모드로 디렉토리를 생성한다", () => {
    const entry: CacheEntry = {
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "abc",
      builtAtMs: 0,
    };

    let mkdirOpts: unknown;
    mockFs.mkdirSync.mockImplementation((_p, opts) => {
      mkdirOpts = opts;
      return undefined;
    });
    mockFs.writeFileSync.mockImplementation(() => { return; });

    writeBuildCache("/my/project", "android", entry);

    expect(mkdirOpts).toMatchObject({ mode: 0o700 });
  });
});

// ── 캐시 키 정규화 (심볼릭 링크) ────────────────────────────────────

describe("getCacheFilePath 심볼릭 링크 정규화", () => {
  it("realpathSync 가능한 경우 실제 경로 기준으로 캐시 키를 생성한다", () => {
    // realpathSync가 성공하는 경우 — getCacheFilePath 내부를 간접 검증
    // writeBuildCache 두 번 호출(symlink 경로 / 실경로)이 같은 파일에 쓰는지 확인
    let writtenPaths: string[] = [];
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockImplementation((p) => {
      writtenPaths.push(String(p));
    });
    // realpathSync mock — symlink를 실경로로 변환
    mockFs.realpathSync.mockImplementation((p: unknown) => {
      if (String(p) === "/symlink/project") return "/real/project";
      return String(p);
    });

    const entry: CacheEntry = {
      artifactPath: "/tmp/app.apk",
      appId: "com.example.app",
      sourceHash: "abc",
      builtAtMs: 0,
    };

    writeBuildCache("/symlink/project", "android", entry);
    writeBuildCache("/real/project", "android", entry);

    expect(writtenPaths.length).toBe(2);
    // 두 경로가 같아야 한다 (같은 캐시 파일)
    expect(writtenPaths[0]).toBe(writtenPaths[1]);
  });
});
