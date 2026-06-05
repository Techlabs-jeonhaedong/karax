/**
 * agent/sanitize.ts — 에이전트 stderr/에러 메시지에서 API 키를 redact한다.
 *
 * 커버 범위:
 *   - Anthropic: sk-ant-api03-... (하이픈 포함 전체)
 *   - OpenAI: sk-...  sk-proj-...
 *   - Google: AIza... (39자 고정)
 *   - GitHub: ghp_  gho_  github_pat_
 *   - AWS: AKIA... 액세스 키 (20자 고정)
 *   - 환경변수 형태: *_API_KEY=값  *_TOKEN=값  *_SECRET=값
 */

const REDACT_PATTERNS: RegExp[] = [
  // 환경변수 형태: KEY/TOKEN/SECRET 이름 = 값 (순서 중요: sk-ant/sk-proj 등 값도 이쪽에서 먼저 커버)
  /[A-Z][A-Z0-9_]*(?:API_KEY|_TOKEN|_SECRET)=[^\s"'`]+/g,
  // Anthropic sk-ant-api03- (하이픈 포함 전체, 가장 구체적)
  /sk-ant-[A-Za-z0-9\-_]{8,}/g,
  // OpenAI / 일반 sk- 패턴 (8자 이상)
  /sk-[A-Za-z0-9\-_]{8,}/g,
  // Google AIza (AIza + 최소 34자)
  /AIza[A-Za-z0-9\-_]{34,}/g,
  // GitHub Personal Access Token
  /github_pat_[A-Za-z0-9_]{20,}/g,
  // GitHub OAuth/App tokens
  /gh[op]_[A-Za-z0-9]{20,}/g,
  // AWS Access Key ID (AKIA 접두사, 20자 고정)
  /AKIA[A-Z0-9]{16}/g,
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
