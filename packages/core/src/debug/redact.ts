/**
 * packages/core/src/debug/redact.ts
 *
 * 민감 정보 redact 유틸리티.
 * 순수 함수, 외부 의존 없음 (core zod-only 제약 준수).
 *
 * 커버 범위:
 *   - Anthropic: sk-ant-api03-... (하이픈 포함 전체)
 *   - OpenAI: sk-...  sk-proj-...
 *   - Google: AIza... (39자 고정)
 *   - GitHub: ghp_  gho_  github_pat_
 *   - AWS: AKIA... 액세스 키 (20자 고정)
 *   - 환경변수 형태: *_API_KEY=값  *_TOKEN=값  *_SECRET=값
 *   - Bearer 토큰: Authorization: Bearer <token>
 *   - JWT: eyJ...eyJ...signature 패턴
 *   - 세션 쿠키: sessionid=  session_id=  _session=
 *   - URL 파라미터: api_key/apikey/token/password/secret/auth=값
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
  // Bearer 토큰 (대소문자 무관)
  /Bearer\s+\S+/gi,
  // JWT: eyJ... 헤더.페이로드.서명 형태 (정확한 3-part 매칭)
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // 세션 쿠키: sessionid/session_id/_session=값 (세미콜론·공백 전까지)
  /(?:sessionid|session_id|_session)=[^\s;]+/gi,
  // URL 쿼리 파라미터: api_key/apikey/token/password/secret/auth=값
  /[?&](?:api_?key|token|password|secret|auth)=[^\s&"']+/gi,
];

/**
 * 문자열에서 API 키, 토큰, 시크릿 패턴을 [REDACTED]로 치환한다.
 * 순수 함수, 부작용 없음.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * 프로세스 실행 invocation의 민감 정보를 구조적으로 마스킹한다.
 *
 * - env 객체의 모든 값을 [REDACTED]로 치환 (키 이름만 보존)
 * - args 중 --api-key 다음 값을 마스킹
 *
 * 원본 객체를 변경하지 않는다 (불변).
 */
export function redactInvocation(inv: {
  bin: string;
  args: string[];
  env?: Record<string, string>;
}): { bin: string; args: string[]; env?: Record<string, string> } {
  // args: --api-key 다음 값 마스킹
  const redactedArgs = inv.args.map((arg, i) => {
    if (i > 0 && inv.args[i - 1] === "--api-key") {
      return "[REDACTED]";
    }
    return arg;
  });

  // env: 모든 값을 [REDACTED]로 치환 (구조적 마스킹)
  let redactedEnv: Record<string, string> | undefined;
  if (inv.env !== undefined) {
    redactedEnv = Object.fromEntries(
      Object.keys(inv.env).map((key) => [key, "[REDACTED]"])
    );
  }

  return {
    bin: inv.bin,
    args: redactedArgs,
    ...(redactedEnv !== undefined ? { env: redactedEnv } : {}),
  };
}

/**
 * 자식 프로세스 크래시 결과를 사람이 읽기 좋은 문자열로 포맷한다.
 *
 * 정상 종료(status!=null && signal==null && error 없음)면 null 반환.
 * 시그널 종료나 spawn 에러면 사유 문자열 반환.
 */
export function formatRespawnCrash(result: {
  status: number | null;
  signal: string | null;
  error?: Error;
}): string | null {
  const { status, signal, error } = result;

  // 정상 종료: status가 있고 signal이 없고 error도 없음
  if (status !== null && signal === null && !error) {
    return null;
  }

  // 시그널 종료
  if (signal !== null) {
    return `자식 프로세스가 시그널로 종료됨: ${signal}`;
  }

  // spawn 에러
  if (error) {
    return `자식 프로세스 시작 실패: ${error.message}`;
  }

  // status=null, signal=null, error 없음 — 알 수 없는 크래시
  return "자식 프로세스가 알 수 없는 이유로 종료됨";
}
