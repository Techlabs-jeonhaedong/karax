/**
 * agent/types.ts — 에이전트 관련 타입
 */

export type AgentKind = "claude" | "codex" | "gemini";

export interface AgentInvocation {
  bin: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentRunOptions {
  prompt: string;
  apiKey?: string;
  /**
   * 스크린샷 저장 디렉토리 절대경로.
   * claude 에이전트에서 스코프 제한 Read를 허용할 때 사용한다.
   * 미전달 시 기존 동작(--allowedTools Bash만)을 유지한다.
   */
  screenshotsDir?: string;
}
