/**
 * packages/cli/src/debug.ts (Phase C-1)
 *
 * CLI 진입점 전용 디버그 유틸리티.
 *
 * 불변 제약:
 * - stdout 계약 불변 — 모든 디버그 출력은 stderr 전용
 * - printError off: 기존 console.error("오류:", message)와 byte-identical
 * - printError on: E2eError code/details · Error stack을 stderr로 추가 (redact + strip)
 */

import { redactSecrets } from "@karax/core";

/** 제어문자 패턴 (탭·CR·LF 제외) */
const CTRL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * 디버그 모드를 결정한다.
 * 우선순위: 명시 플래그 > KARAX_DEBUG==="1" > false
 *
 * @param flagValue CLI --debug 플래그 값 (undefined이면 미지정)
 * @param env       process.env (DI로 테스트 가능하게)
 */
export function resolveDebug(
  flagValue: boolean | undefined,
  env: NodeJS.ProcessEnv
): boolean {
  if (flagValue !== undefined) return flagValue;
  return env["KARAX_DEBUG"] === "1";
}

/**
 * 오류를 출력한다.
 *
 * debug=false (기존 포맷 byte-identical):
 *   console.error("오류:", message)
 *
 * debug=true (추가 정보):
 *   위와 동일 + stderr로 stack·code·details (redactSecrets + strip 통과)
 */
export function printError(e: unknown, debug: boolean): void {
  // 기존 포맷: console.error("오류:", message) — 절대 변경 금지
  const message = e instanceof Error ? e.message : String(e);
  console.error("오류:", message);

  if (!debug) return;

  // debug 시 추가 정보를 stderr로 출력
  const lines: string[] = [];

  if (e instanceof Error) {
    if (e.stack) {
      lines.push(`stack: ${e.stack}`);
    }
    // E2eError 전용 필드
    const asE2e = e as { code?: unknown; details?: unknown };
    if (asE2e.code !== undefined) {
      lines.push(`code: ${String(asE2e.code)}`);
    }
    if (asE2e.details !== undefined) {
      lines.push(`details: ${String(asE2e.details)}`);
    }
  }

  if (lines.length > 0) {
    const raw = lines.join("\n");
    const safe = redactSecrets(raw).replace(CTRL_CHARS_RE, "");
    process.stderr.write(`[karax/debug] ${safe}\n`);
  }
}
