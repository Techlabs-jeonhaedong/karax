/**
 * agent/sanitize.ts — @karax/core redactSecrets의 re-export shim.
 *
 * 기존 export 시그니처(`sanitizeStderr`)를 유지한 채
 * 내부 구현을 @karax/core의 redactSecrets로 위임한다.
 * importer(agent/runner.ts, crash/detect.ts)는 변경 없이 동작한다.
 */

import { redactSecrets } from "@karax/core";

/**
 * stderr 문자열에서 API 키 패턴을 [REDACTED]로 치환한다.
 * @karax/core redactSecrets에 위임한다.
 */
export function sanitizeStderr(stderr: string): string {
  return redactSecrets(stderr);
}
