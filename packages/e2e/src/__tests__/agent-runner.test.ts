/**
 * agent/runner.ts 단위 테스트 (execa mock)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { E2eError } from "../types.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { runAgent } from "../agent/runner.js";
import { sanitizeStderr } from "../agent/sanitize.js";

const mockExeca = vi.mocked(execa);
let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-runner-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeResultJson(data: object): string {
  const resultPath = path.join(tmpDir, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(data));
  return resultPath;
}

describe("runAgent", () => {
  it("성공 케이스: 유효한 result.json을 반환한다", async () => {
    const validResult = {
      outcome: "pass",
      summary: "테스트 통과",
      steps: [{ index: 1, description: "탭", status: "pass" }],
    };
    makeResultJson(validResult);

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const result = await runAgent(
      { bin: "claude", args: ["-p", "test"], env: {} },
      tmpDir
    );

    expect(result.outcome).toBe("pass");
    expect(result.steps).toHaveLength(1);
  });

  it("스키마 위반 시 1회 재시도 후 성공", async () => {
    // 1차: 잘못된 result.json 생성
    const invalidResult = { outcome: "unknown" };
    const resultPath = path.join(tmpDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(invalidResult));

    mockExeca
      // 1차 실행 (스키마 위반 → 재시도)
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      // 2차 실행 (성공)
      .mockImplementationOnce(async () => {
        fs.writeFileSync(
          resultPath,
          JSON.stringify({ outcome: "pass", summary: "재시도 성공", steps: [] })
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      });

    const result = await runAgent(
      { bin: "claude", args: ["-p", "test"], env: {} },
      tmpDir
    );

    expect(result.outcome).toBe("pass");
    expect(mockExeca).toHaveBeenCalledTimes(2);
  });

  it("스키마 위반 2회 시 AGENT_OUTPUT_INVALID 에러", async () => {
    const invalidResult = { outcome: "bad", summary: "요약" };
    makeResultJson(invalidResult);

    mockExeca.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    await expect(
      runAgent({ bin: "claude", args: ["-p", "test"], env: {} }, tmpDir)
    ).rejects.toMatchObject({ code: "AGENT_OUTPUT_INVALID" });
  });

  it("타임아웃 시 AGENT_TIMEOUT 에러", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("timed out"), { timedOut: true })
    );

    await expect(
      runAgent({ bin: "claude", args: ["-p", "test"], env: {} }, tmpDir, { timeoutMs: 100 })
    ).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
  });

  it("CLI 미설치 시 AGENT_CLI_MISSING 에러", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT: not found"), { code: "ENOENT" })
    );

    await expect(
      runAgent({ bin: "claude", args: ["-p", "test"], env: {} }, tmpDir)
    ).rejects.toMatchObject({ code: "AGENT_CLI_MISSING" });
  });

  it("result.json 없으면 AGENT_OUTPUT_INVALID (재시도 후도 없음)", async () => {
    // result.json 미생성
    mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await expect(
      runAgent({ bin: "claude", args: ["-p", "test"], env: {} }, tmpDir)
    ).rejects.toMatchObject({ code: "AGENT_OUTPUT_INVALID" });
  });
});

  it("스키마 위반 재시도 시 2차 invocation의 -p 인수에 zod 에러 메시지가 첨부된다", async () => {
    // 1차: outcome이 enum 위반인 잘못된 result.json
    const invalidResult = { outcome: "unknown", summary: "요약", steps: [] };
    const resultPath = path.join(tmpDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(invalidResult));

    let secondCallArgs: string[] = [];
    mockExeca
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockImplementationOnce(async (_bin: string, args: string[]) => {
        secondCallArgs = args;
        fs.writeFileSync(
          resultPath,
          JSON.stringify({ outcome: "pass", summary: "재시도 성공", steps: [] })
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      });

    await runAgent({ bin: "claude", args: ["-p", "original prompt"], env: {} }, tmpDir);

    // 2차 호출의 -p 인수에 zod 에러 문자열이 포함돼야 한다
    const pIdx = secondCallArgs.indexOf("-p");
    expect(pIdx).not.toBe(-1);
    const secondPrompt = secondCallArgs[pIdx + 1];
    expect(secondPrompt).toContain("original prompt");
    // zod 에러 메시지(outcome 위반)가 실제로 포함되는지
    expect(secondPrompt.toLowerCase()).toMatch(/invalid_enum_value|outcome|zod|validation/i);
  });

  it("retryPromptSuffix 명시 전달 시 자동 생성 suffix를 override한다", async () => {
    const invalidResult = { outcome: "unknown", summary: "요약", steps: [] };
    const resultPath = path.join(tmpDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(invalidResult));

    let secondCallArgs: string[] = [];
    mockExeca
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockImplementationOnce(async (_bin: string, args: string[]) => {
        secondCallArgs = args;
        fs.writeFileSync(
          resultPath,
          JSON.stringify({ outcome: "pass", summary: "재시도 성공", steps: [] })
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      });

    await runAgent(
      { bin: "claude", args: ["-p", "original prompt"], env: {} },
      tmpDir,
      { retryPromptSuffix: "CUSTOM_OVERRIDE_SUFFIX" }
    );

    const pIdx = secondCallArgs.indexOf("-p");
    expect(pIdx).not.toBe(-1);
    const secondPrompt = secondCallArgs[pIdx + 1];
    // 명시 override가 포함돼야 한다
    expect(secondPrompt).toContain("CUSTOM_OVERRIDE_SUFFIX");
  });

  it("execAgent 실패 시 E2eError details에 sanitize된 stderr가 포함된다", async () => {
    const stderrWithKey = "ANTHROPIC_API_KEY=sk-ant-secret123 connection refused";
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("Process exited with code 1"), {
        exitCode: 1,
        stderr: stderrWithKey,
      })
    );

    // result.json 없으므로 AGENT_OUTPUT_INVALID까지 가거나
    // 비정상 종료는 무시 후 result.json 검증에서 AGENT_OUTPUT_INVALID로 귀결됨
    // execAgent는 일반 exitCode 에러는 삼키고 result.json 검증으로 처리하므로
    // stderr가 E2eError details에 포함되는 경우는 별도 throw 경로 없음.
    // 따라서 이 테스트는 AGENT_OUTPUT_INVALID로 귀결되되,
    // 에러의 details에 redact된 stderr가 있어야 함.
    // 현재 구현에서 일반 exitCode 에러는 throw하지 않으므로:
    // → execAgent가 stderr 포함 에러로 throw하는 케이스를 만들어야 함.
    // runner.ts 수정 후 이 테스트가 통과되어야 한다.

    // 우선 AGENT_OUTPUT_INVALID로 귀결되는 것만 확인 (result.json 없음)
    mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    // stderr가 있는 일반 프로세스 에러 → 무시하고 result.json 검증으로 처리
    // details 검증을 위해 별도로 execAgent를 직접 테스트할 수 없으므로
    // runAgent 레벨에서 AGENT_OUTPUT_INVALID에 details가 포함되는지 확인
    const stderrErr = Object.assign(new Error("exit 1"), {
      exitCode: 1,
      stderr: "ANTHROPIC_API_KEY=sk-ant-realkey456 failed to connect",
    });

    const mockExecaFresh = vi.mocked(execa);
    mockExecaFresh.mockReset();
    // 1차: stderr 포함 에러 → execAgent가 이 경우 throw해야 details에 포함됨
    // 현재는 throw 안 함 → 수정 후 behavior 확인
    // 수정 후: 일반 exitCode 에러도 E2eError로 throw하고 details에 sanitized stderr 포함
    mockExecaFresh.mockRejectedValueOnce(stderrErr);

    await expect(
      runAgent({ bin: "claude", args: ["-p", "test"], env: {} }, tmpDir)
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof Error)) return false;
      // E2eError의 details에 redact된 stderr가 있어야 한다 (API 키는 제거)
      const err = e as { details?: string; code?: string };
      // code가 뭐든 details가 있고 원본 API 키가 없어야 함
      return (
        typeof err.details === "string" &&
        !err.details.includes("sk-ant-realkey456") &&
        err.details.includes("[REDACTED]")
      );
    });
  });

// ── sanitizeStderr — API 키 redact (항목 9) ──────────────────────

describe("sanitizeStderr", () => {
  it("ANTHROPIC_API_KEY=<value> 를 [REDACTED]로 치환한다", () => {
    const input = "Error: ANTHROPIC_API_KEY=sk-ant-realkey123 not accepted";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("sk-ant-realkey123");
    expect(result).toContain("[REDACTED]");
  });

  it("OPENAI_API_KEY=<value> 를 [REDACTED]로 치환한다", () => {
    const input = "OPENAI_API_KEY=sk-openai-abc failed";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("sk-openai-abc");
    expect(result).toContain("[REDACTED]");
  });

  it("GEMINI_API_KEY=<value> 를 [REDACTED]로 치환한다", () => {
    const input = "GEMINI_API_KEY=gemini-xyz-key error";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("gemini-xyz-key");
    expect(result).toContain("[REDACTED]");
  });

  it("sk- 로 시작하는 API 키 패턴을 [REDACTED]로 치환한다", () => {
    const input = "Bearer sk-proj-abcdefghijklmn1234567890";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("sk-proj-abcdefghijklmn1234567890");
    expect(result).toContain("[REDACTED]");
  });

  it("API 키가 없는 평범한 에러 메시지는 변환하지 않는다", () => {
    const input = "Error: connection refused to localhost:8080";
    const result = sanitizeStderr(input);
    expect(result).toBe(input);
  });
});
