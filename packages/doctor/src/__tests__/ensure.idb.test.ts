/**
 * ensure.ts — ensureIdb() 단위 테스트
 *
 * execa를 vi.mock으로 격리하고 process.platform을 Object.defineProperty로 제어한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { ensureIdb } from "../ensure.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

function setPlatform(platform: string) {
  Object.defineProperty(process, "platform", {
    value: platform,
    writable: true,
    configurable: true,
  });
}

const originalPlatform = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  setPlatform("darwin");
  // 기본 거부 설정
  mockExeca.mockRejectedValue(Object.assign(new Error("not found"), { exitCode: 1 }));
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe("ensureIdb", () => {
  it("non-darwin이면 skipped='non-darwin' 반환, execa 호출 없음", async () => {
    setPlatform("linux");
    const result = await ensureIdb();
    expect(result.skipped).toBe("non-darwin");
    expect(result.installed).toBe(false);
    expect(result.alreadyPresent).toBe(false);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("idb --version 성공이면 alreadyPresent=true, brew install 미호출", async () => {
    // idb --version 성공
    mockExeca.mockResolvedValueOnce({ stdout: "1.1.7", stderr: "", exitCode: 0 });
    const result = await ensureIdb();
    expect(result.alreadyPresent).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.skipped).toBeUndefined();
    // brew install은 호출되지 않아야 함
    const brewInstallCalled = mockExeca.mock.calls.some(
      (call: unknown[]) =>
        call[0] === "brew" &&
        Array.isArray(call[1]) &&
        (call[1] as string[]).includes("install")
    );
    expect(brewInstallCalled).toBe(false);
  });

  it("idb 없음 + brew 없음 → skipped='no-brew', 에러 throw 없음", async () => {
    // idb --version 실패
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    // brew --version 실패
    mockExeca.mockRejectedValueOnce(new Error("brew: not found"));
    const result = await ensureIdb();
    expect(result.skipped).toBe("no-brew");
    expect(result.installed).toBe(false);
    expect(result.alreadyPresent).toBe(false);
  });

  it("idb 없음 + brew 있음 → brew install 호출, installed=true 반환", async () => {
    // idb --version 실패
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    // brew --version 성공
    mockExeca.mockResolvedValueOnce({ stdout: "Homebrew 4.5.0", stderr: "", exitCode: 0 });
    // brew install 성공
    mockExeca.mockResolvedValueOnce({ stdout: "✓ installed", stderr: "", exitCode: 0 });

    const result = await ensureIdb();
    expect(result.installed).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(result.skipped).toBeUndefined();
  });

  it("brew install 호출 시 올바른 인자(facebook/fb/idb-companion)를 사용한다", async () => {
    // idb --version 실패
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    // brew --version 성공
    mockExeca.mockResolvedValueOnce({ stdout: "Homebrew 4.5.0", stderr: "", exitCode: 0 });
    // brew install 성공
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await ensureIdb();

    const brewInstallCall = mockExeca.mock.calls.find(
      (call: unknown[]) =>
        call[0] === "brew" &&
        Array.isArray(call[1]) &&
        (call[1] as string[]).includes("install")
    );
    expect(brewInstallCall).toBeDefined();
    expect(brewInstallCall![1]).toContain("facebook/fb/idb-companion");
  });

  it("brew install 호출 시 stdout이 process.stderr로 리다이렉트된다 (MCP 프로토콜 보호)", async () => {
    // idb --version 실패
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    // brew --version 성공
    mockExeca.mockResolvedValueOnce({ stdout: "Homebrew 4.5.0", stderr: "", exitCode: 0 });
    // brew install 성공
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await ensureIdb();

    const brewInstallCall = mockExeca.mock.calls.find(
      (call: unknown[]) =>
        call[0] === "brew" &&
        Array.isArray(call[1]) &&
        (call[1] as string[]).includes("install")
    );
    expect(brewInstallCall).toBeDefined();
    const opts = brewInstallCall![2] as Record<string, unknown>;
    expect(opts).toBeDefined();
    expect(opts.stdout).toBe(process.stderr);
  });

  it("brew install 실패 시 에러를 throw한다", async () => {
    // idb --version 실패
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    // brew --version 성공
    mockExeca.mockResolvedValueOnce({ stdout: "Homebrew 4.5.0", stderr: "", exitCode: 0 });
    // brew install 실패
    mockExeca.mockRejectedValueOnce(new Error("brew install failed"));

    await expect(ensureIdb()).rejects.toThrow("brew install failed");
  });
});
