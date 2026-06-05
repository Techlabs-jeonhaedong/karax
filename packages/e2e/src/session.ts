/**
 * session.ts — 세션 디렉토리 생성
 */

import fs from "fs";
import path from "path";

export interface SessionInfo {
  dir: string;
  screenshotsDir: string;
  sessionId: string;
}

/**
 * outDir 아래에 타임스탬프 기반 세션 디렉토리를 생성한다.
 * 구조: <outDir>/<timestamp>/screenshots/
 */
export function createSessionDir(outDir: string): SessionInfo {
  const sessionId = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+$/, "");

  const dir = path.join(outDir, sessionId);
  const screenshotsDir = path.join(dir, "screenshots");

  fs.mkdirSync(screenshotsDir, { recursive: true });

  return { dir, screenshotsDir, sessionId };
}
