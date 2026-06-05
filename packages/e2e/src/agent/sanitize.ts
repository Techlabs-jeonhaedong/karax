/**
 * agent/sanitize.ts — 에이전트 stderr/에러 메시지에서 API 키를 redact한다.
 */

const REDACT_PATTERNS: RegExp[] = [
  // KEY=value 형태의 환경변수 값
  /(ANTHROPIC|OPENAI|GEMINI)_API_KEY=\S+/g,
  // sk- 형태의 API 키 (8자 이상)
  /sk-[A-Za-z0-9\-_]{8,}/g,
];

/**
 * stderr 문자열에서 API 키 패턴을 [REDACTED]로 치환한다.
 */
export function sanitizeStderr(stderr: string): string {
  let result = stderr;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
