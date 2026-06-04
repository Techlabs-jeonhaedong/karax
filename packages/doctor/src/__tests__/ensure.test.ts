/**
 * ensure.ts — ensureChromium() 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { ensureChromium } from "../ensure.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureChromium", () => {
  it("chromium 이미 존재하면 설치 안 함", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "/home/.cache/ms-playwright/chromium-1169/chrome-linux/chrome",
      stderr: "",
      exitCode: 0,
    });

    const result = await ensureChromium();
    expect(result.installed).toBe(false);
    expect(result.alreadyPresent).toBe(true);
    expect(mockExeca).toHaveBeenCalledTimes(1);
  });

  it("chromium 없으면 npx playwright install chromium 실행", async () => {
    mockExeca
      .mockRejectedValueOnce(new Error("No executable found"))
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const result = await ensureChromium();
    expect(result.installed).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(mockExeca).toHaveBeenCalledTimes(2);
  });

  it("chromium 설치 자체 실패 시 에러 throw", async () => {
    mockExeca
      .mockRejectedValueOnce(new Error("No executable found"))
      .mockRejectedValueOnce(new Error("network error"));

    await expect(ensureChromium()).rejects.toThrow();
  });

  it("빈 path 응답도 missing으로 처리해 설치 시도", async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const result = await ensureChromium();
    expect(result.installed).toBe(true);
  });
});
