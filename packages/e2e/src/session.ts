/**
 * session.ts — 세션 디렉토리 생성
 */

import fs from "fs";
import path from "path";

export interface SessionInfo {
  dir: string;
  screenshotsDir: string;
  appMapDir: string;
  /** M11: 비디오 녹화 파일 저장 디렉토리 */
  videosDir: string;
  sessionId: string;
}

/** 최대 suffix 카운터 (충돌 회피 상한) */
const MAX_SESSION_SUFFIX = 100;

/**
 * outDir 아래에 타임스탬프 기반 세션 디렉토리를 생성한다.
 * 구조: <outDir>/<timestamp>/screenshots/
 *
 * 밀리초를 포함한 sessionId를 사용하고, 동일 타임스탬프 충돌 시
 * -2, -3 suffix로 회피한다 (상한 100).
 */
export function createSessionDir(outDir: string): SessionInfo {
  // 형식: 2026-06-06T12-34-56-789Z (밀리초 포함)
  const baseId = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.(\d{3})Z$/, "-$1Z");

  let sessionId = baseId;
  let dir = path.join(outDir, sessionId);

  if (fs.existsSync(dir)) {
    let found = false;
    for (let suffix = 2; suffix <= MAX_SESSION_SUFFIX; suffix++) {
      sessionId = `${baseId}-${suffix}`;
      dir = path.join(outDir, sessionId);
      if (!fs.existsSync(dir)) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(
        `[karax/e2e] 세션 디렉토리 생성 실패: ${MAX_SESSION_SUFFIX}개 suffix를 모두 소진했습니다 (baseId=${baseId})`
      );
    }
  }

  const screenshotsDir = path.join(dir, "screenshots");
  const appMapDir = path.join(dir, "appmap");
  const videosDir = path.join(dir, "videos");

  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(appMapDir, { recursive: true });
  // videosDir는 recordVideo=true일 때만 생성 — session 생성 시에는 경로만 계산

  return { dir, screenshotsDir, appMapDir, videosDir, sessionId };
}
