/**
 * report/sanitize.ts — 리포트에서 사용되는 경로/데이터 검증 유틸
 */

import path from "path";

/**
 * 에이전트가 기록한 screenshot 상대경로가 screenshotsDir 내부인지 검증한다.
 *
 * @param screenshotsDir  스크린샷이 저장된 기준 디렉토리 (절대경로)
 * @param rel             result.json steps[].screenshot 값 (상대경로 기대)
 * @returns               안전한 절대경로, 또는 null (path traversal 시도 감지)
 */
export function sanitizeScreenshotPath(
  screenshotsDir: string,
  rel: string
): string | null {
  if (!rel || rel.trim().length === 0) return null;

  // 절대경로를 상대경로로 사용하려는 시도 차단
  if (path.isAbsolute(rel)) return null;

  const resolved = path.resolve(screenshotsDir, rel);

  // resolved가 screenshotsDir 내부인지 확인
  // path.resolve는 symlink를 따르지 않으므로 lexical check로 충분
  const base = path.resolve(screenshotsDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    return null;
  }

  return resolved;
}
