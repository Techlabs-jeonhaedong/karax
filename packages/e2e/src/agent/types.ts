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
}
