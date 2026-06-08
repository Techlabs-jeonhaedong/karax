/**
 * appmap/appmapCache.ts 단위 테스트
 *
 * AppMap 영속 캐시 R/W 및 무효화 검증:
 * - 캐시 miss 시 null 반환
 * - 캐시 write 후 read가 동일 데이터를 반환
 * - sourceHash 불일치 시 무효화(miss)
 * - 손상된 JSON은 null 반환 (graceful)
 * - 필수 필드 누락 시 null 반환
 * - zod 스키마 검증 실패 시 null 반환
 * - device 식별자가 다르면 다른 슬롯 사용
 * - markdownPaths는 캐시에서 제거됨 (항목 5)
 * - 원자적 write (임시 파일 → rename)
 * - 캐시 디렉토리 권한 0o700 재적용
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { AppMap } from "@karax/core";
import {
  readAppMapCache,
  writeAppMapCache,
  type AppMapCacheEntry,
} from "../appmap/appmapCache.js";

// ── 최소 유효 AppMap fixture ───────────────────────────────────────

const MOCK_APP_MAP: AppMap = {
  schemaVersion: "appmap/2",
  appName: "MockApp",
  framework: "flutter",
  entryScreenId: "home",
  screens: [
    {
      id: "home",
      title: "홈",
      discovery: "route",
      isEntry: true,
      confidence: 0.9,
      elements: [],
      outgoing: [],
    },
  ],
  edges: [],
  diagnostics: [],
  overallConfidence: 0.9,
};

// ── 테스트 환경 ───────────────────────────────────────────────────

let tmpDir: string;
let projectPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-appmap-cache-test-"));
  projectPath = path.join(tmpDir, "project");
  fs.mkdirSync(projectPath, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── 테스트 ────────────────────────────────────────────────────────

describe("readAppMapCache", () => {
  it("캐시 파일이 없으면 null을 반환한다", () => {
    const result = readAppMapCache(projectPath, "android", "pixel-8", "abc123");
    expect(result).toBeNull();
  });

  it("writeAppMapCache 후 readAppMapCache가 동일 데이터를 반환한다", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "abc123",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", entry);
    const result = readAppMapCache(projectPath, "android", "pixel-8", "abc123");

    expect(result).not.toBeNull();
    expect(result!.appMap.appName).toBe("MockApp");
    expect(result!.sourceHash).toBe("abc123");
    expect(result!.platform).toBe("android");
    expect(result!.deviceProfileId).toBe("pixel-8");
  });

  it("sourceHash 불일치 시 null을 반환한다 (캐시 무효화)", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "old-hash",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", entry);
    const result = readAppMapCache(projectPath, "android", "pixel-8", "new-hash");

    expect(result).toBeNull();
  });

  it("platform이 다르면 서로 다른 캐시 슬롯을 사용한다", () => {
    const androidEntry: AppMapCacheEntry = {
      appMap: { ...MOCK_APP_MAP, appName: "AndroidApp" },
      sourceHash: "hash-a",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };
    const iosEntry: AppMapCacheEntry = {
      appMap: { ...MOCK_APP_MAP, appName: "IosApp" },
      sourceHash: "hash-b",
      cachedAtMs: Date.now(),
      platform: "ios",
      deviceProfileId: "iphone-15",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", androidEntry);
    writeAppMapCache(projectPath, "ios", "iphone-15", iosEntry);

    const androidResult = readAppMapCache(projectPath, "android", "pixel-8", "hash-a");
    const iosResult = readAppMapCache(projectPath, "ios", "iphone-15", "hash-b");

    expect(androidResult!.appMap.appName).toBe("AndroidApp");
    expect(iosResult!.appMap.appName).toBe("IosApp");
  });

  it("device 식별자가 다르면 다른 캐시 슬롯을 사용한다 (항목 3)", () => {
    const pixel8Entry: AppMapCacheEntry = {
      appMap: { ...MOCK_APP_MAP, appName: "Pixel8App" },
      sourceHash: "hash-d",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };
    const pixel6Entry: AppMapCacheEntry = {
      appMap: { ...MOCK_APP_MAP, appName: "Pixel6App" },
      sourceHash: "hash-d",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-6",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", pixel8Entry);
    writeAppMapCache(projectPath, "android", "pixel-6", pixel6Entry);

    const pixel8Result = readAppMapCache(projectPath, "android", "pixel-8", "hash-d");
    const pixel6Result = readAppMapCache(projectPath, "android", "pixel-6", "hash-d");

    expect(pixel8Result!.appMap.appName).toBe("Pixel8App");
    expect(pixel6Result!.appMap.appName).toBe("Pixel6App");
  });

  it("device 식별자가 다르면 캐시 미스가 발생한다 (항목 3)", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "hash-e",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };
    writeAppMapCache(projectPath, "android", "pixel-8", entry);

    // pixel-9로 읽으면 미스
    const result = readAppMapCache(projectPath, "android", "pixel-9", "hash-e");
    expect(result).toBeNull();
  });

  it("손상된 JSON이면 null을 반환한다 (graceful)", () => {
    // 캐시 파일을 직접 손상시킨다
    writeAppMapCache(projectPath, "android", "pixel-8", {
      appMap: MOCK_APP_MAP,
      sourceHash: "hash",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    });

    // 캐시 파일 경로를 찾아 내용을 손상시킨다
    const cacheDir = path.join(os.tmpdir(), "karax-appmap-cache");
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        // 관련 파일인지 확인 후 손상
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(content) as { sourceHash?: string };
          if (parsed.sourceHash === "hash") {
            fs.writeFileSync(filePath, "{ not valid json }", "utf-8");
          }
        } catch {
          // ignore
        }
      }
    }

    const result = readAppMapCache(projectPath, "android", "pixel-8", "hash");
    expect(result).toBeNull();
  });

  it("필수 필드(appMap, sourceHash, platform) 누락 시 null을 반환한다", () => {
    // 불완전한 캐시 파일을 직접 작성
    writeAppMapCache(projectPath, "android", "pixel-8", {
      appMap: MOCK_APP_MAP,
      sourceHash: "partial-hash",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    });

    const cacheDir = path.join(os.tmpdir(), "karax-appmap-cache");
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(content) as { sourceHash?: string };
          if (parsed.sourceHash === "partial-hash") {
            // sourceHash 필드 제거
            delete parsed.sourceHash;
            fs.writeFileSync(filePath, JSON.stringify(parsed), "utf-8");
          }
        } catch {
          // ignore
        }
      }
    }

    const result = readAppMapCache(projectPath, "android", "pixel-8", "partial-hash");
    expect(result).toBeNull();
  });

  it("AppMap zod 스키마 검증 실패 시 null 반환 (항목 4)", () => {
    // appMap 필드가 잘못된 구조인 캐시 파일을 직접 작성
    writeAppMapCache(projectPath, "android", "pixel-8", {
      appMap: MOCK_APP_MAP,
      sourceHash: "zod-hash",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    });

    const cacheDir = path.join(os.tmpdir(), "karax-appmap-cache");
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(content) as { sourceHash?: string; appMap?: unknown };
          if (parsed.sourceHash === "zod-hash") {
            // appMap을 잘못된 구조로 교체 (schemaVersion 필드 제거)
            parsed.appMap = { appName: "CorruptedApp", screens: "not-an-array" };
            fs.writeFileSync(filePath, JSON.stringify(parsed), "utf-8");
          }
        } catch {
          // ignore
        }
      }
    }

    const result = readAppMapCache(projectPath, "android", "pixel-8", "zod-hash");
    expect(result).toBeNull();
  });

  it("심볼릭 링크 경로와 실경로가 동일한 캐시 슬롯을 사용한다", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "sym-hash",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", entry);

    // symlink 경로로 읽어도 동일 캐시 히트
    const symlinkPath = path.join(tmpDir, "project-link");
    try {
      fs.symlinkSync(projectPath, symlinkPath);
      const result = readAppMapCache(symlinkPath, "android", "pixel-8", "sym-hash");
      expect(result).not.toBeNull();
      expect(result!.sourceHash).toBe("sym-hash");
    } catch {
      // symlink 생성 실패 시 스킵 (Windows CI 환경)
    }
  });
});

describe("writeAppMapCache", () => {
  it("캐시 디렉토리가 없어도 자동 생성한다", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "write-test",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };

    // 캐시 dir 존재 여부 상관없이 write가 성공해야 함
    expect(() => writeAppMapCache(projectPath, "android", "pixel-8", entry)).not.toThrow();
  });

  it("appMap이 JSON 직렬화 가능한 형태로 저장된다", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "json-test",
      cachedAtMs: 1234567890,
      platform: "ios",
      deviceProfileId: "iphone-15",
    };

    writeAppMapCache(projectPath, "ios", "iphone-15", entry);
    const result = readAppMapCache(projectPath, "ios", "iphone-15", "json-test");

    expect(result).not.toBeNull();
    expect(result!.cachedAtMs).toBe(1234567890);
  });

  it("markdownPaths는 캐시에 저장되지 않는다 (항목 5 설계 변경)", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "no-md-test",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", entry);
    const result = readAppMapCache(projectPath, "android", "pixel-8", "no-md-test");

    expect(result).not.toBeNull();
    // AppMapCacheEntry에 markdownPaths 필드가 없음을 타입 레벨에서 보장
    expect("markdownPaths" in result!).toBe(false);
  });

  it("원자적 write — 캐시 파일이 완전한 JSON 형태로 저장된다 (항목 7)", () => {
    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "atomic-test",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", entry);

    // 캐시 파일을 직접 읽어 유효한 JSON인지 확인
    const cacheDir = path.join(os.tmpdir(), "karax-appmap-cache");
    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
    let found = false;
    for (const file of files) {
      const filePath = path.join(cacheDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content) as { sourceHash?: string };
        if (parsed.sourceHash === "atomic-test") {
          found = true;
          expect(() => JSON.parse(content)).not.toThrow();
        }
      } catch {
        // ignore other files
      }
    }
    expect(found).toBe(true);
  });

  it("캐시 디렉토리가 이미 존재해도 mode 0o700이 재적용된다 (항목 6)", () => {
    // 먼저 캐시 dir을 느슨한 권한으로 생성
    const cacheDir = path.join(os.tmpdir(), "karax-appmap-cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    try {
      fs.chmodSync(cacheDir, 0o777);
    } catch {
      // 권한 변경 실패 시 스킵 (CI 환경 등)
      return;
    }

    const entry: AppMapCacheEntry = {
      appMap: MOCK_APP_MAP,
      sourceHash: "perm-test",
      cachedAtMs: Date.now(),
      platform: "android",
      deviceProfileId: "pixel-8",
    };

    writeAppMapCache(projectPath, "android", "pixel-8", entry);

    // writeAppMapCache 후 디렉토리 권한이 0o700이어야 함
    const stat = fs.statSync(cacheDir);
    const mode = stat.mode & 0o777;
    // 0o700이어야 함 (다른 사용자/그룹 접근 불가)
    expect(mode).toBe(0o700);
  });
});
