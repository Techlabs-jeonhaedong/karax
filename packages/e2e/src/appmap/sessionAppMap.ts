/**
 * appmap/sessionAppMap.ts — E2E 세션용 AppMap 생성
 *
 * sdk를 동적 import로만 사용 (순환 의존 방지).
 * 실패 시 throw — 호출부(index.ts)에서 .catch(() => null)로 폴백.
 */

import fs from "fs";
import path from "path";
import type { AppMap } from "@karax/core";
import type { Platform } from "../types.js";


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

export interface GenerateAppMapForSessionOpts {
  projectPath: string;
  framework: "flutter" | "react-native" | "android" | "ios";
  platform: Platform;
  appMapDir: string;
}

// ── 구현 ──────────────────────────────────────────────────────────────────────

export async function generateAppMapForSession(
  opts: GenerateAppMapForSessionOpts
): Promise<SessionAppMap> {
  const { projectPath, framework, platform, appMapDir } = opts;

  // appMapDir이 없으면 생성
  fs.mkdirSync(appMapDir, { recursive: true });

  const deviceProfileId = PLATFORM_DEVICE_PROFILE[platform];

  // sdk를 동적 import로 사용 (e2e→sdk 정적 import는 순환 — 동적으로만)
  const { generateAppMap } = await import("@karax/sdk");

  const result = await generateAppMap({
    projectPath,
    framework,
    device: deviceProfileId,
    write: true,
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
