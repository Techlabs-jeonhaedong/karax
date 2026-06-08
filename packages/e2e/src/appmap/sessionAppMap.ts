/**
 * appmap/sessionAppMap.ts — E2E 세션용 AppMap 생성
 *
 * sdk 의존 없이 순수 DI(의존성 주입) 방식으로 동작한다.
 * AppMapGenerator 함수를 주입받아 실행 — e2e→sdk 순환 의존 완전 제거.
 * 실패 시 throw — 호출부(index.ts)에서 .catch(() => null)로 폴백.
 *
 * reuseAppMap(기본 false, opt-in)이 활성화되면 소스 핑거프린트 기반 디스크 캐시를 사용해
 * 같은 소스에서 반복 실행 시 AppMap 재생성을 건너뛴다.
 *
 * 캐시 히트 시 설계 (항목 1):
 *   캐시는 AppMap 데이터만 저장. 마크다운 파일은 항상 현재 세션 appMapDir에 재생성한다.
 *   이를 통해 stale 경로가 에이전트 프롬프트에 주입되는 문제를 구조적으로 방지한다.
 */

import fs from "fs";
import path from "path";
import type { AppMap } from "@karax/core";
import { renderAppMapMarkdown } from "@karax/core";
import type { Platform, AppMapGenerator } from "../types.js";
import { computeSourceFingerprint } from "../build/cache.js";
import { readAppMapCache, writeAppMapCache } from "./appmapCache.js";

// ── 디바이스 프로파일 고정 맵 ──────────────────────────────────────────────

const PLATFORM_DEVICE_PROFILE: Record<Platform, string> = {
  android: "pixel-8",
  ios: "iphone-15",
};

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface SessionAppMap {
  appMap: AppMap;
  appMapJsonPath: string;
  markdownIndexPath: string | null;
  deviceProfileId: string;
}

export type { AppMapGenerator };

export interface GenerateAppMapForSessionOpts {
  projectPath: string;
  framework: "flutter" | "react-native" | "android" | "ios";
  platform: Platform;
  appMapDir: string;
  /** AppMap 생성기 — sdk에서 주입. 없으면 throw. */
  generator: AppMapGenerator;
  /**
   * AppMap 세션 간 캐시 재사용 여부. 기본값 false (opt-in, reuseBuild와 일관).
   * true이면 소스 핑거프린트가 같은 경우 AppMap을 재생성하지 않고 캐시에서 로드한다.
   * false이면 항상 새로 생성한다.
   *
   * 캐시 히트 시에도 마크다운 파일은 현재 세션 appMapDir에 새로 기록된다.
   * 캐시는 AppMap 데이터(내용)만 재사용한다 (항목 1, 2).
   */
  reuseAppMap?: boolean;
}

// ── 구현 ──────────────────────────────────────────────────────────────────────

export async function generateAppMapForSession(
  opts: GenerateAppMapForSessionOpts
): Promise<SessionAppMap> {
  const {
    projectPath,
    framework,
    platform,
    appMapDir,
    generator,
    reuseAppMap = false, // 항목 2: 기본값 false (opt-in)
  } = opts;

  // appMapDir이 없으면 생성
  fs.mkdirSync(appMapDir, { recursive: true });

  const deviceProfileId = PLATFORM_DEVICE_PROFILE[platform];

  // ── 캐시 히트 경로 ─────────────────────────────────────────────────────────
  if (reuseAppMap) {
    const fp = computeSourceFingerprint(projectPath, framework);
    const cached = readAppMapCache(projectPath, platform, deviceProfileId, fp.hash);

    if (cached !== null) {
      // 캐시 히트: appmap.json을 새 appMapDir에 복사
      process.stderr.write(
        `[karax/e2e] AppMap 캐시 히트 (소스 핑거프린트 일치): ${projectPath}\n`
      );

      const appMapJsonPath = path.join(appMapDir, "appmap.json");
      fs.writeFileSync(appMapJsonPath, JSON.stringify(cached.appMap, null, 2), "utf-8");

      // 항목 1: 마크다운을 현재 세션 appMapDir에 재생성 (stale 경로 방지)
      const markdownIndexPath = writeMarkdownToDir(cached.appMap, appMapDir);

      return {
        appMap: cached.appMap,
        appMapJsonPath,
        markdownIndexPath,
        deviceProfileId: cached.deviceProfileId,
      };
    }
  }

  // ── 캐시 미스: generator 호출 ─────────────────────────────────────────────
  const result = await generator({
    projectPath,
    framework,
    device: deviceProfileId,
    outDir: appMapDir,
  });

  // appmap.json을 별도 저장 (M4 karax ui --appmap의 정규 입력)
  const appMapJsonPath = path.join(appMapDir, "appmap.json");
  fs.writeFileSync(appMapJsonPath, JSON.stringify(result.appMap, null, 2), "utf-8");

  // 마크다운 경로: generator가 appMapDir에 쓴 경로 중 첫 번째를 사용.
  // generator의 writtenPaths는 이미 outDir(=appMapDir) 내 경로이므로 유효함.
  // 단, writtenPaths가 비어 있으면 renderAppMapMarkdown으로 직접 생성.
  let markdownIndexPath: string | null;
  if (result.writtenPaths.length > 0) {
    markdownIndexPath = result.writtenPaths[0];
  } else {
    markdownIndexPath = writeMarkdownToDir(result.appMap, appMapDir);
  }

  // ── 캐시에 저장 (reuseAppMap=true일 때) ──────────────────────────────────
  if (reuseAppMap) {
    try {
      const fp = computeSourceFingerprint(projectPath, framework);
      writeAppMapCache(projectPath, platform, deviceProfileId, {
        appMap: result.appMap,
        sourceHash: fp.hash,
        cachedAtMs: Date.now(),
        platform,
        deviceProfileId,
      });
    } catch (cacheErr) {
      process.stderr.write(
        `[karax/e2e] AppMap 캐시 기록 실패 (무시): ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}\n`
      );
    }
  }

  return {
    appMap: result.appMap,
    appMapJsonPath,
    markdownIndexPath,
    deviceProfileId,
  };
}

// ── 내부 유틸 ──────────────────────────────────────────────────────────────────

/**
 * AppMap을 마크다운으로 변환해 appMapDir에 저장하고 경로를 반환한다.
 * 실패 시 null 반환 (마크다운 없어도 appmap.json은 사용 가능).
 */
function writeMarkdownToDir(appMap: AppMap, appMapDir: string): string | null {
  try {
    const docs = renderAppMapMarkdown(appMap);
    if (docs.length === 0) return null;
    const doc = docs[0];
    const safeFileName = path.basename(doc.fileName);
    const mdPath = path.join(appMapDir, safeFileName);
    fs.writeFileSync(mdPath, doc.content, "utf-8");
    return mdPath;
  } catch {
    return null;
  }
}
