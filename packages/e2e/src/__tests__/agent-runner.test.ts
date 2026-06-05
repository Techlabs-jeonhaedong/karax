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

const mockExeca = vi.mocked(execa);
let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-e2e-runner-test-"));
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
