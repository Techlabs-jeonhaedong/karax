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
      return {
        bin: "claude",
        args: [
          "-p",
          opts.prompt,
          "--output-format",
          "json",
          "--allowedTools",
          "Bash",
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
