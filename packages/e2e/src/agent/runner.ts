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
import { redactInvocation } from "@karax/core";
import { createDebugArtifacts } from "../debug.js";
import type { AgentInvocation } from "./types.js";

const DEFAULT_TIMEOUT = 900_000;

export interface RunAgentOptions {
  timeoutMs?: number;
  /** 재시도 시 prompt에 검증 오류를 첨부 (없으면 동일 prompt로 재시도) */
  retryPromptSuffix?: string;
  /**
   * 디버그 아티팩트 저장 디렉토리.
   * 지정 시 invocation.json / raw-stdout.txt / raw-stderr.txt 를 기록한다.
   * 미지정 시 no-op.
   */
  debugDir?: string;
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
  const artifacts = createDebugArtifacts(opts.debugDir);

  // debug: invocation.json 기록 (API 키 redact)
  await artifacts.writeJson("agent/invocation.json", redactInvocation(invocation));

  // 1차 시도
  const { stdout: firstStdout, stderr: firstStderr } = await execAgent(invocation, timeoutMs);

  // debug: raw stdout/stderr 기록
  await artifacts.write("agent/raw-stdout.txt", firstStdout);
  await artifacts.write("agent/raw-stderr.txt", firstStderr);

  const firstResult = readAndValidateResult(resultJsonPath);
  if (firstResult.data) return firstResult.data;

  // 2차 시도: opts.retryPromptSuffix가 명시되면 override, 없으면 zod issues로 자동 구성
  const retrySuffix =
    opts.retryPromptSuffix ??
    buildValidationErrorSuffix(firstResult.zodIssues);
  const retryInvocation = buildRetryInvocation(invocation, retrySuffix);
  const { stdout: retryStdout, stderr: retryStderr } = await execAgent(retryInvocation, timeoutMs);

  // debug: 2차 시도 raw 기록 (덮어쓰기)
  await artifacts.write("agent/raw-stdout.txt", firstStdout + "\n--- retry ---\n" + retryStdout);
  await artifacts.write("agent/raw-stderr.txt", firstStderr + "\n--- retry ---\n" + retryStderr);

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
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execa(invocation.bin, invocation.args, {
      env: invocation.env,
      timeout: timeoutMs,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { timedOut?: boolean; stderr?: string; stdout?: string };

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
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

interface ValidateResult {
  data: AgentResult | null;
  zodIssues: import("zod").ZodIssue[] | null;
}

function readAndValidateResult(resultJsonPath: string): ValidateResult {
  if (!fs.existsSync(resultJsonPath)) return { data: null, zodIssues: null };

  try {
    const raw = JSON.parse(fs.readFileSync(resultJsonPath, "utf-8"));
    const parsed = AgentResultSchema.safeParse(raw);
    if (parsed.success) return { data: parsed.data, zodIssues: null };
    return { data: null, zodIssues: parsed.error.issues };
  } catch {
    return { data: null, zodIssues: null };
  }
}

const VALIDATION_SUFFIX_MAX_LEN = 500;

/**
 * zod 검증 실패 issues에서 path·code·expected만 추출해 고정 포맷 suffix를 구성한다.
 *
 * 보안: received 원문 값과 message 자유 텍스트는 포함하지 않는다.
 * LLM이 쓴 result.json의 received 값(예: invalid_enum_value의 실제 값)이
 * 프롬프트에 그대로 들어가면 프롬프트 인젝션 벡터가 된다.
 * suffix 전체 길이 상한(500자)을 두어 초과분을 절단한다.
 */
function buildValidationErrorSuffix(zodIssues: import("zod").ZodIssue[] | null): string {
  const header = "이전 응답의 result.json이 스키마 검증에 실패했습니다.\n";
  const footer = "스키마에 맞는 result.json을 다시 생성해주세요.";

  if (!zodIssues || zodIssues.length === 0) {
    const base = "이전 응답의 result.json이 유효하지 않습니다. 스키마에 맞는 result.json을 다시 생성해주세요.";
    return base.slice(0, VALIDATION_SUFFIX_MAX_LEN);
  }

  const issueLines = zodIssues.map((issue) => {
    const pathStr = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    // expected는 enum·literal 등에만 존재하므로 타입 단언으로 안전 접근
    const expected = (issue as { expected?: unknown }).expected;
    const expectedStr = expected !== undefined ? ` expected=${String(expected)}` : "";
    return `  - path=${pathStr} code=${issue.code}${expectedStr}`;
  });

  const body = issueLines.join("\n");
  const full = `${header}검증 오류:\n${body}\n${footer}`;
  return full.slice(0, VALIDATION_SUFFIX_MAX_LEN);
}

function buildRetryInvocation(
  original: AgentInvocation,
  suffix: string
): AgentInvocation {
  // suffix는 호출자(runAgent)가 항상 전달 — 모듈-private, 유일 호출처 runAgent
  // prompt는 args에서 마지막 '-p' 다음 인수
  const args = [...original.args];
  const pIdx = args.lastIndexOf("-p");
  if (pIdx !== -1 && pIdx + 1 < args.length) {
    args[pIdx + 1] = `${args[pIdx + 1]}\n\n${suffix}`;
  }

  return { ...original, args };
}
