/**
 * appmap/sessionAppMap.ts — E2E 세션용 AppMap 생성
 *
 * sdk 의존 없이 순수 DI(의존성 주입) 방식으로 동작한다.
 * AppMapGenerator 함수를 주입받아 실행 — e2e→sdk 순환 의존 완전 제거.
 * 실패 시 throw — 호출부(index.ts)에서 .catch(() => null)로 폴백.
 */

import fs from "fs";
import path from "path";
import type { AppMap } from "@karax/core";
import type { Platform, AppMapGenerator } from "../types.js";

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
}

// ── 구현 ──────────────────────────────────────────────────────────────────────

export async function generateAppMapForSession(
  opts: GenerateAppMapForSessionOpts
): Promise<SessionAppMap> {
  const { projectPath, framework, platform, appMapDir, generator } = opts;

  // appMapDir이 없으면 생성
  fs.mkdirSync(appMapDir, { recursive: true });

  const deviceProfileId = PLATFORM_DEVICE_PROFILE[platform];

  const result = await generator({
    projectPath,
    framework,
    device: deviceProfileId,
    outDir: appMapDir,
  });

  // appmap.json을 별도 저장 (M4 karax ui --appmap의 정규 입력)
  const appMapJsonPath = path.join(appMapDir, "appmap.json");
  fs.writeFileSync(appMapJsonPath, JSON.stringify(result.appMap, null, 2), "utf-8");

  // 첫 번째 마크다운 파일 경로 (없으면 null)
  const markdownIndexPath =
    result.writtenPaths.length > 0 ? result.writtenPaths[0] : null;

  return {
    appMap: result.appMap,
    appMapJsonPath,
    markdownIndexPath,
    deviceProfileId,
  };
}
