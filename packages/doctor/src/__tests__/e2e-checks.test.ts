/**
 * doctor E2E 체크 (adb/emulator/agentClis) 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../checks/androidSdk.js", () => ({
  detectAndroidSdkPath: vi.fn().mockResolvedValue("/sdk"),
}));

import { execa } from "execa";
import { checkAdb } from "../checks/adb.js";
import { checkEmulator } from "../checks/emulator.js";
import { checkAgentClis } from "../checks/agentClis.js";

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── checkAdb ──────────────────────────────────────────────────────

describe("checkAdb", () => {
  it("adb version 성공 시 status=ok", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Android Debug Bridge version 1.0.41",
      stderr: "",
      exitCode: 0,
    } as unknown as ReturnType<typeof execa>);

    const result = await checkAdb();
    expect(result.status).toBe("ok");
    expect(result.id).toBe("adb");
    expect(result.version).toContain("1.0.41");
  });

  it("adb 없으면 status=missing", async () => {
    mockExeca.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const result = await checkAdb();
    expect(result.status).toBe("missing");
  });
});

// ── checkEmulator ─────────────────────────────────────────────────

describe("checkEmulator", () => {
  it("emulator + AVD 있으면 status=ok", async () => {
    mockExeca
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "Android emulator version 33.1.20",
        exitCode: 0,
      } as unknown as ReturnType<typeof execa>)
      .mockResolvedValueOnce({
        stdout: "Pixel_7_API_34\n",
        stderr: "",
        exitCode: 0,
      } as unknown as ReturnType<typeof execa>);

    const result = await checkEmulator();
    expect(result.status).toBe("ok");
    expect(result.version).toContain("Pixel_7_API_34");
  });

  it("emulator 있지만 AVD 없으면 status=missing", async () => {
    mockExeca
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "Android emulator version 33.1.20",
        exitCode: 0,
      } as unknown as ReturnType<typeof execa>)
      .mockResolvedValueOnce({
        stdout: "\n",
        stderr: "",
        exitCode: 0,
      } as unknown as ReturnType<typeof execa>);

    const result = await checkEmulator();
    expect(result.status).toBe("missing");
  });

  it("emulator 없으면 status=missing", async () => {
    mockExeca.mockRejectedValue(new Error("ENOENT"));

    const result = await checkEmulator();
    expect(result.status).toBe("missing");
  });
});

// ── checkAgentClis ────────────────────────────────────────────────

describe("checkAgentClis", () => {
  it("claude 있으면 claude-cli status=ok", async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: "1.0.0\n", stderr: "", exitCode: 0 } as unknown as ReturnType<typeof execa>) // claude
      .mockRejectedValueOnce(new Error("ENOENT")) // codex
      .mockRejectedValueOnce(new Error("ENOENT")); // gemini

    const results = await checkAgentClis();
    const claude = results.find((r) => r.id === "claude-cli");
    const codex = results.find((r) => r.id === "codex-cli");

    expect(claude?.status).toBe("ok");
    expect(codex?.status).toBe("missing");
  });

  it("모두 없으면 3개 모두 status=missing", async () => {
    mockExeca.mockRejectedValue(new Error("ENOENT"));

    const results = await checkAgentClis();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "missing")).toBe(true);
  });

  it("3개 결과가 모두 반환된다", async () => {
    mockExeca.mockResolvedValue({ stdout: "1.0.0", stderr: "", exitCode: 0 } as unknown as ReturnType<typeof execa>);

    const results = await checkAgentClis();
    expect(results).toHaveLength(3);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("claude-cli");
    expect(ids).toContain("codex-cli");
    expect(ids).toContain("gemini-cli");
  });
});
