/**
 * agent/runner.ts — execa spawn → 검증 → 1회 재시도
 */

import fs from "fs";
import path from "path";
import { execa } from "execa";
import { E2eError } from "../types.js";
import { AgentResultSchema, type AgentResult } from "./resultSchema.js";
import { buildAgentInvocation } from "./args.js";
import { sanitizeStderr } from "./sanitize.js";
import type { AgentInvocation } from "./types.js";

const DEFAULT_TIMEOUT = 900_000;

export interface RunAgentOptions {
  timeoutMs?: number;
  /** 재시도 시 prompt에 검증 오류를 첨부 (없으면 동일 prompt로 재시도) */
  retryPromptSuffix?: string;
}

/**
 * 에이전트 CLI를 실행하고 result.json을 검증·반환한다.
 * 스키마 위반 시 1회 재시도. 재실패 시 AGENT_OUTPUT_INVALID.
 */
export async function runAgent(
  invocation: AgentInvocation,
  screenshotsDir: string,
  opts: RunAgentOptions = {}
): Promise<AgentResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const resultJsonPath = path.join(screenshotsDir, "result.json");

  // 1차 시도
  await execAgent(invocation, timeoutMs);
  const firstResult = readAndValidateResult(resultJsonPath);
  if (firstResult.data) return firstResult.data;

  // 2차 시도: opts.retryPromptSuffix가 명시되면 override, 없으면 zod 에러 메시지로 자동 구성
  const retrySuffix =
    opts.retryPromptSuffix ??
    buildValidationErrorSuffix(firstResult.zodError);
  const retryInvocation = buildRetryInvocation(invocation, retrySuffix);
  await execAgent(retryInvocation, timeoutMs);
  const secondResult = readAndValidateResult(resultJsonPath);
  if (secondResult.data) return secondResult.data;

  throw new E2eError(
    "AGENT_OUTPUT_INVALID",
    "에이전트가 유효한 result.json을 두 번 모두 생성하지 못했습니다."
  );
}

async function execAgent(
  invocation: AgentInvocation,
  timeoutMs: number
): Promise<void> {
  try {
    await execa(invocation.bin, invocation.args, {
      env: invocation.env,
      timeout: timeoutMs,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { timedOut?: boolean; stderr?: string };

    if (err.timedOut || (err.message && (err.message.includes("timed out") || err.message.includes("ETIMEDOUT")))) {
      throw new E2eError(
        "AGENT_TIMEOUT",
        `에이전트 실행 타임아웃 (${timeoutMs / 1000}s): ${invocation.bin}`
      );
    }

    if (err.code === "ENOENT") {
      throw new E2eError(
        "AGENT_CLI_MISSING",
        `에이전트 CLI를 찾을 수 없습니다: ${invocation.bin}. 설치 후 다시 시도해주세요.`
      );
    }

    // stderr가 있으면 API 키를 redact해서 details에 포함한다
    if (err.stderr) {
      const safeStderr = sanitizeStderr(String(err.stderr));
      throw new E2eError(
        "AGENT_OUTPUT_INVALID",
        `에이전트가 비정상 종료했습니다: ${invocation.bin}`,
        safeStderr
      );
    }

    // 비정상 종료코드는 result.json 검증으로 처리 (에이전트가 fail 결과를 파일에 썼을 수 있음)
  }
}

interface ValidateResult {
  data: AgentResult | null;
  zodError: string | null;
}

function readAndValidateResult(resultJsonPath: string): ValidateResult {
  if (!fs.existsSync(resultJsonPath)) return { data: null, zodError: null };

  try {
    const raw = JSON.parse(fs.readFileSync(resultJsonPath, "utf-8"));
    const parsed = AgentResultSchema.safeParse(raw);
    if (parsed.success) return { data: parsed.data, zodError: null };
    return { data: null, zodError: parsed.error.message };
  } catch {
    return { data: null, zodError: null };
  }
}

/** zod 검증 실패 메시지를 재시도 prompt suffix로 변환한다 */
function buildValidationErrorSuffix(zodError: string | null): string {
  if (!zodError) {
    return "이전 응답의 result.json이 유효하지 않습니다. 스키마에 맞는 result.json을 다시 생성해주세요.";
  }
  return `이전 응답의 result.json이 스키마 검증에 실패했습니다.\n검증 오류: ${zodError}\n스키마에 맞는 result.json을 다시 생성해주세요.`;
}

function buildRetryInvocation(
  original: AgentInvocation,
  suffix: string
): AgentInvocation {
  // prompt는 args에서 마지막 '-p' 다음 인수
  const args = [...original.args];
  const pIdx = args.lastIndexOf("-p");
  if (pIdx !== -1 && pIdx + 1 < args.length) {
    args[pIdx + 1] = `${args[pIdx + 1]}\n\n${suffix}`;
  }

  return { ...original, args };
}
