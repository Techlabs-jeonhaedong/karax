/**
 * agent/args.ts — 순수 함수: CLI별 argv+env 구성
 *
 * 플래그 검증 결과:
 * - claude: -p, --output-format json, --allowedTools "Bash"
 *   headless -p 모드에서 allowedTools에 지정된 도구는 자동 허용, 그 외 차단됨.
 *   // VERIFY: 실제 claude CLI 버전에서 --allowedTools 단독 동작 확인 필요
 * - codex: exec <prompt> --full-auto 확인됨 (codex exec --help 2026-06-05 기준)
 *   // NOTE: codex --full-auto는 자율 실행 모드임. 더 제한적인 대안 없음.
 * - gemini: -p <prompt> --yolo 확인됨 (gemini --help 2026-06-05 기준)
 *   // NOTE: gemini --yolo는 자율 실행 모드임. 더 제한적인 대안 없음.
 */

import type { AgentKind, AgentInvocation, AgentRunOptions } from "./types.js";

/**
 * screenshotsDir 경로가 Read 규칙에 안전한지 판별한다.
 *
 * 허용:
 * - 유니코드 문자·숫자(\p{L}\p{N} + u 플래그): 한글, 일본어 등 비ASCII 경로 지원
 * - 기호: _ . / : @ -
 *
 * 불허 (Read 규칙 구문·인자 분리를 깨는 문자):
 * - 공백 (--allowedTools 공백 구분 목록을 깨뜨림)
 * - 괄호 () — Read() 구문을 조기 종료시킴
 * - 별표 * — 글로브 충돌
 * - 콤마 , — 인자 구분자
 * - 셸 메타문자: ; ` $ & | ? ! # " ' \
 * - 개행·탭 등 제어문자
 *
 * unsafe면 throw 하지 않는다 — 호출 측에서 Read 부여를 생략(폴백)한다.
 */
export function isPathSafeForReadRule(dir: string): boolean {
  if (!dir || !dir.startsWith("/")) return false;
  // 허용 문자: 유니코드 글자/숫자, 그리고 _ . / : @ -
  // 그 외 모든 문자(공백, 괄호, 글로브, 셸 메타, 제어문자 등)는 불허
  return /^[\p{L}\p{N}_.\/:@\-]+$/u.test(dir);
}

/**
 * 에이전트 서브프로세스에 전달할 최소 env를 구성한다.
 *
 * 보안 원칙:
 * - process.env를 통째로 전파하지 않는다 (GITHUB_TOKEN, AWS_*, 타사 API 키 등 시크릿 노출 방지)
 * - 에이전트 CLI 구동에 필요한 최소 키만 명시적으로 선택한다
 * - 선택된 에이전트의 API 키 1개만 주입한다
 */
function buildMinimalEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  // 필수 셸 환경
  if (process.env["PATH"]) env["PATH"] = process.env["PATH"];
  if (process.env["HOME"]) env["HOME"] = process.env["HOME"];
  if (process.env["TMPDIR"]) env["TMPDIR"] = process.env["TMPDIR"];
  if (process.env["SHELL"]) env["SHELL"] = process.env["SHELL"];

  // Android SDK (adb 사용 에이전트를 위해)
  if (process.env["ANDROID_HOME"]) env["ANDROID_HOME"] = process.env["ANDROID_HOME"];
  if (process.env["ANDROID_SDK_ROOT"]) env["ANDROID_SDK_ROOT"] = process.env["ANDROID_SDK_ROOT"];

  return env;
}

/**
 * 에이전트 CLI 호출 인수를 구성한다.
 * apiKey가 있을 때만 해당 에이전트의 API 키를 주입, 없으면 ambient env passthrough(구독 로그인 활용).
 * 다른 에이전트의 API 키나 GITHUB_TOKEN, AWS_* 등 시크릿은 절대 전파하지 않는다.
 */
export function buildAgentInvocation(
  kind: AgentKind,
  opts: AgentRunOptions
): AgentInvocation {
  const baseEnv = buildMinimalEnv();

  switch (kind) {
    case "claude": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        // apiKey 명시 시: 해당 키만 주입
        env["ANTHROPIC_API_KEY"] = opts.apiKey;
      } else {
        // apiKey 없음: ambient env의 ANTHROPIC_API_KEY만 passthrough (구독 로그인 활용)
        if (process.env["ANTHROPIC_API_KEY"]) {
          env["ANTHROPIC_API_KEY"] = process.env["ANTHROPIC_API_KEY"];
        }
      }

      // screenshotsDir 있으면 스코프 제한 Read 허용
      // VERIFIED (2026-06-06, 실 claude CLI 실험): 아래 형식 모두 동작 확인됨.
      //   - 반복 --allowedTools 플래그는 누적됨 (Bash 유지: bash=BASH_OK)
      //   - Read(//{절대경로}/**) — 절대경로가 /로 시작해 슬래시 3개가 되어도 정상 매칭
      //   - 스코프 실효: 범위 안 파일 읽힘, 범위 밖 파일 DENIED 확인
      //   - 단, Bash 자체는 경로 스코프 불가 — Read 표면 최소화 목적의 방어선임
      //
      // 허용 문자: 유니코드(@, 한글 등 포함), _ . / : @ -
      // unsafe(공백·괄호·셸 메타 등)면 Read 부여를 생략하고 Bash만 유지 (폴백).
      //   → 에러 throw 하지 않음: E2E 자체가 계속 동작해야 하며 Read 미부여는 더 제한적이라 보안상 안전.
      //   → 경로 길이+첫 20자만 stderr에 경고 출력.
      const allowedToolsArgs: string[] = ["--allowedTools", "Bash"];
      if (opts.screenshotsDir !== undefined) {
        if (isPathSafeForReadRule(opts.screenshotsDir)) {
          allowedToolsArgs.push("--allowedTools", `Read(//${opts.screenshotsDir}/**)`);
        } else {
          const preview = opts.screenshotsDir.slice(0, 20);
          process.stderr.write(
            `[karax/e2e] screenshotsDir에 Read-unsafe 문자가 포함됨 — Read 스코프 생략, Bash만 허용. ` +
            `(길이=${opts.screenshotsDir.length}, 앞20자="${preview}")\n`
          );
        }
      }

      return {
        bin: "claude",
        args: [
          "-p",
          opts.prompt,
          "--output-format",
          "json",
          ...allowedToolsArgs,
          // VERIFY: headless -p 모드에서 --allowedTools만으로 Bash 자동 허용 확인 필요.
          // --dangerously-skip-permissions 제거 — allowedTools 지정 도구만 허용하는 것이 더 제한적임.
        ],
        env,
      };
    }

    case "codex": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        env["OPENAI_API_KEY"] = opts.apiKey;
      } else {
        if (process.env["OPENAI_API_KEY"]) {
          env["OPENAI_API_KEY"] = process.env["OPENAI_API_KEY"];
        }
      }
      return {
        bin: "codex",
        // NOTE: codex --full-auto는 자율 실행 모드. 더 제한적인 대안이 없어 유지.
        args: [
          "exec",
          opts.prompt,
          "--full-auto",
        ],
        env,
      };
    }

    case "gemini": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        env["GEMINI_API_KEY"] = opts.apiKey;
      } else {
        if (process.env["GEMINI_API_KEY"]) {
          env["GEMINI_API_KEY"] = process.env["GEMINI_API_KEY"];
        }
      }
      return {
        bin: "gemini",
        // NOTE: gemini --yolo는 자율 실행 모드. 더 제한적인 대안이 없어 유지.
        args: [
          "-p",
          opts.prompt,
          "--yolo",
        ],
        env,
      };
    }
  }
}
