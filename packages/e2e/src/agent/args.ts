/**
 * agent/args.ts — 순수 함수: CLI별 argv+env 구성
 *
 * 플래그 검증 결과:
 * - claude: -p, --output-format json, --allowedTools "Bash", --dangerously-skip-permissions
 *   확인됨 (claude --help 2026-06-05 기준)
 *   참고: --permission-mode bypassPermissions도 존재하나 --dangerously-skip-permissions가 간결함
 * - codex: exec <prompt> --full-auto 확인됨 (codex exec --help 2026-06-05 기준)
 * - gemini: -p <prompt> --yolo 확인됨 (gemini --help 2026-06-05 기준)
 */

import type { AgentKind, AgentInvocation, AgentRunOptions } from "./types.js";

/**
 * 에이전트 CLI 호출 인수를 구성한다.
 * apiKey가 있을 때만 해당 env 키를 주입, 없으면 passthrough(구독 로그인 활용).
 */
export function buildAgentInvocation(
  kind: AgentKind,
  opts: AgentRunOptions
): AgentInvocation {
  const baseEnv = { ...(process.env as Record<string, string>) };

  switch (kind) {
    case "claude": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        env["ANTHROPIC_API_KEY"] = opts.apiKey;
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
          "--dangerously-skip-permissions",
        ],
        env,
      };
    }

    case "codex": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        env["OPENAI_API_KEY"] = opts.apiKey;
      }
      return {
        bin: "codex",
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
      }
      return {
        bin: "gemini",
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
