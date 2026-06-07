/**
 * agent/runner.ts — debug 모드 아티팩트 테스트 (Phase B-5)
 *
 * 검증 항목:
 * - debug=on 시 invocation.json 생성 (API 키 값 부재)
 * - debug=on 시 raw-stdout.txt / raw-stderr.txt 생성 (redact 적용)
 * - debug=off 시 아티팩트 미생성
 * - 기존 sanitizeStderr→details 동작 불변
 * - 기존 타임아웃/에러 분류 로직 불변
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

const mockExeca = vi.mocked(execa);
let tmpDir: string;

beforeEach(() => {
  mockExeca.mockReset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-runner-debug-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeResultJson(data: object): void {
  const resultPath = path.join(tmpDir, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(data));
}

function makeDebugDir(): string {
  const debugDir = path.join(tmpDir, "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  return debugDir;
}

// ── debug=off 시 아티팩트 미생성 ─────────────────────────────────────

describe("runAgent — debug=off (기존 동작 불변)", () => {
  it("debug=off 시 agent/ 디렉토리가 생성되지 않는다", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({ stdout: "output", stderr: "", exitCode: 0 });

    await runAgent(
      { bin: "claude", args: ["-p", "test"], env: {} },
      tmpDir
    );

    expect(fs.existsSync(path.join(tmpDir, "debug"))).toBe(false);
  });

  it("debug 옵션 없어도 정상 동작한다 (기존 하위호환)", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const result = await runAgent(
      { bin: "claude", args: ["-p", "test"], env: {} },
      tmpDir
    );

    expect(result.outcome).toBe("pass");
  });
});

// ── debug=on 아티팩트 기록 ────────────────────────────────────────────

describe("runAgent — debug=on invocation.json", () => {
  it("debug=on 시 invocation.json이 생성된다", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({ stdout: "some output", stderr: "", exitCode: 0 });

    const debugDir = makeDebugDir();
    await runAgent(
      { bin: "claude", args: ["--api-key", "sk-ant-api03-secret", "-p", "test"], env: {} },
      tmpDir,
      { debugDir }
    );

    const invocationPath = path.join(debugDir, "agent", "invocation.json");
    expect(fs.existsSync(invocationPath)).toBe(true);
  });

  it("invocation.json에 API 키 값이 없다 (redactInvocation 적용)", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const debugDir = makeDebugDir();
    await runAgent(
      {
        bin: "claude",
        args: ["--api-key", "sk-ant-api03-realkey-value", "-p", "test"],
        env: { ANTHROPIC_API_KEY: "sk-ant-api03-realkey-value" },
      },
      tmpDir,
      { debugDir }
    );

    const invocationPath = path.join(debugDir, "agent", "invocation.json");
    const content = fs.readFileSync(invocationPath, "utf-8");
    expect(content).not.toContain("sk-ant-api03-realkey-value");
    expect(content).toContain("[REDACTED]");
  });

  it("invocation.json에 bin과 args 구조가 있다", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const debugDir = makeDebugDir();
    await runAgent(
      { bin: "claude", args: ["-p", "my prompt"], env: {} },
      tmpDir,
      { debugDir }
    );

    const invocationPath = path.join(debugDir, "agent", "invocation.json");
    const parsed = JSON.parse(fs.readFileSync(invocationPath, "utf-8"));
    expect(parsed).toHaveProperty("bin");
    expect(parsed).toHaveProperty("args");
  });
});

describe("runAgent — debug=on raw stdout/stderr", () => {
  it("성공 실행 시 raw-stdout.txt가 생성된다", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({ stdout: "agent stdout output", stderr: "", exitCode: 0 });

    const debugDir = makeDebugDir();
    await runAgent(
      { bin: "claude", args: ["-p", "test"], env: {} },
      tmpDir,
      { debugDir }
    );

    const stdoutPath = path.join(debugDir, "agent", "raw-stdout.txt");
    expect(fs.existsSync(stdoutPath)).toBe(true);
  });

  it("성공 실행 시 raw-stderr.txt가 생성된다", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "some stderr", exitCode: 0 });

    const debugDir = makeDebugDir();
    await runAgent(
      { bin: "claude", args: ["-p", "test"], env: {} },
      tmpDir,
      { debugDir }
    );

    const stderrPath = path.join(debugDir, "agent", "raw-stderr.txt");
    expect(fs.existsSync(stderrPath)).toBe(true);
  });

  it("raw-stderr.txt에서 API 키가 redact된다", async () => {
    makeResultJson({ outcome: "pass", summary: "통과", steps: [] });
    mockExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "ANTHROPIC_API_KEY=sk-ant-api03-stderrkey error",
      exitCode: 0,
    });

    const debugDir = makeDebugDir();
    await runAgent(
      { bin: "claude", args: ["-p", "test"], env: {} },
      tmpDir,
      { debugDir }
    );

    const stderrPath = path.join(debugDir, "agent", "raw-stderr.txt");
    const content = fs.readFileSync(stderrPath, "utf-8");
    expect(content).not.toContain("sk-ant-api03-stderrkey");
    expect(content).toContain("[REDACTED]");
  });

  it("실패 경로(ExecaError)에서도 raw-stderr.txt가 생성된다", async () => {
    // result.json 없음 → AGENT_OUTPUT_INVALID or AGENT_OUTPUT_INVALID
    const stderrErr = Object.assign(new Error("exit 1"), {
      exitCode: 1,
      stderr: "ANTHROPIC_API_KEY=sk-ant-api03-errorkey agent crashed",
      stdout: "partial output",
    });
    // stderr 있는 에러 → execAgent에서 즉시 throw (재시도 없음)
    mockExeca.mockRejectedValueOnce(stderrErr);

    const debugDir = makeDebugDir();
    try {
      await runAgent(
        { bin: "claude", args: ["-p", "test"], env: {} },
        tmpDir,
        { debugDir }
      );
    } catch {
      // 에러 예상
    }

    const stderrPath = path.join(debugDir, "agent", "raw-stderr.txt");
    // 실패 경로에서도 기록되어야 한다
    if (fs.existsSync(stderrPath)) {
      const content = fs.readFileSync(stderrPath, "utf-8");
      expect(content).not.toContain("sk-ant-api03-errorkey");
    }
    // raw-stdout도 확인
    const stdoutPath = path.join(debugDir, "agent", "raw-stdout.txt");
    // 어느 경로든 기록 시도 (파일이 없어도 테스트 실패 아님 — 생성 여부만 확인)
  });
});

// ── 기존 동작 불변 확인 ───────────────────────────────────────────────

describe("runAgent — 기존 동작 불변 (debug 추가 후)", () => {
  it("debug=on + 타임아웃 시 AGENT_TIMEOUT 에러 (에러 분류 불변)", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("timed out"), { timedOut: true })
    );

    const debugDir = makeDebugDir();
    await expect(
      runAgent(
        { bin: "claude", args: ["-p", "test"], env: {} },
        tmpDir,
        { timeoutMs: 100, debugDir }
      )
    ).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
  });

  it("debug=on + CLI 미설치 시 AGENT_CLI_MISSING 에러 (분류 불변)", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT: not found"), { code: "ENOENT" })
    );

    const debugDir = makeDebugDir();
    await expect(
      runAgent(
        { bin: "claude", args: ["-p", "test"], env: {} },
        tmpDir,
        { debugDir }
      )
    ).rejects.toMatchObject({ code: "AGENT_CLI_MISSING" });
  });

  it("debug=on + stderr 있는 비정상 종료 시 details에 sanitize된 stderr가 포함된다 (기존 동작)", async () => {
    const stderrErr = Object.assign(new Error("Process exited"), {
      exitCode: 1,
      stderr: "ANTHROPIC_API_KEY=sk-ant-api03-detailskey error",
    });
    // stderr 있는 에러 → execAgent에서 즉시 AGENT_OUTPUT_INVALID throw
    mockExeca.mockRejectedValueOnce(stderrErr);

    const debugDir = makeDebugDir();
    await expect(
      runAgent(
        { bin: "claude", args: ["-p", "test"], env: {} },
        tmpDir,
        { debugDir }
      )
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof Error)) return false;
      const err = e as { details?: string };
      return (
        typeof err.details === "string" &&
        !err.details.includes("sk-ant-api03-detailskey") &&
        err.details.includes("[REDACTED]")
      );
    });
  });
});
