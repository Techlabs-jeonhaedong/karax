/**
 * checks/agentClis.ts — claude/codex/gemini CLI --version 확인
 */

import { execa } from "execa";
import type { CheckResult } from "./types.js";

interface AgentCliSpec {
  id: string;
  label: string;
  bin: string;
  versionArgs: string[];
  hint: string;
}

const AGENT_CLIS: AgentCliSpec[] = [
  {
    id: "claude-cli",
    label: "Claude CLI (claude)",
    bin: "claude",
    versionArgs: ["--version"],
    hint: "Claude CLI가 필요합니다. https://claude.ai/code 에서 설치해주세요.",
  },
  {
    id: "codex-cli",
    label: "Codex CLI (codex)",
    bin: "codex",
    versionArgs: ["--version"],
    hint: "Codex CLI가 필요합니다. https://github.com/openai/codex 에서 설치해주세요.",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI (gemini)",
    bin: "gemini",
    versionArgs: ["--version"],
    hint: "Gemini CLI가 필요합니다. npm install -g @google/generative-ai-cli 로 설치해주세요.",
  },
];

/**
 * 에이전트 CLI 3종(claude/codex/gemini) 설치 여부를 확인한다.
 */
export async function checkAgentClis(): Promise<CheckResult[]> {
  return Promise.all(AGENT_CLIS.map(checkAgentCli));
}

async function checkAgentCli(spec: AgentCliSpec): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint" | "optional"> = {
    id: spec.id,
    label: spec.label,
    autoInstallable: false,
    optional: true,
    hint: spec.hint,
  };

  try {
    const result = await execa(spec.bin, spec.versionArgs, { timeout: 10_000 });
    const version = String(result.stdout).split("\n")[0]?.trim() ?? "unknown";
    return { ...base, status: "ok", version };
  } catch {
    return { ...base, status: "missing" };
  }
}
