/**
 * sanitize.ts — 터미널 출력용 제어 문자 정화 헬퍼
 */

/** \x00-\x1f (C0 제어 문자) 및 \x7f (DEL)을 제거한다. */
export function stripControls(str: string): string {
  return str.replace(/[\x00-\x1f\x7f]/g, "");
}
