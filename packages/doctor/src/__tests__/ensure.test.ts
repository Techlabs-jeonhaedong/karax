/**
 * ensure.ts — ensureChromium() / getChromiumPath() 단위 테스트
 *
 * ESM 환경에서는 같은 모듈 내 함수 간 직접 참조를 mock으로 가로채기 어렵다.
 * 따라서 현재 환경에서 실제 동작을 검증하는 방식으로 테스트한다.
 *
 * - playwright가 설치된 환경: getChromiumPath()가 경로를 반환 → ensureChromium()은 alreadyPresent
 * - playwright 미설치 환경: null 반환 → npx install 시도
 *
 * npx playwright install은 네트워크 의존이 있어 단위 테스트에서는 execa를 mock으로 제어한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { getChromiumPath, ensureChromium } from "../ensure.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getChromiumPath", () => {
  it("playwright Node API가 유효한 경로를 반환하거나, null을 반환해야 한다", async () => {
    const result = await getChromiumPath();
    // 경로(string) 또는 null만 허용
    expect(result === null || typeof result === "string").toBe(true);
    if (result !== null) {
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

describe("ensureChromium", () => {
  it("현재 환경에서 playwright Chromium 상태를 정확히 보고한다", async () => {
    const chromiumPath = await getChromiumPath();

    if (chromiumPath) {
      // playwright 설치된 환경: alreadyPresent=true, 설치 미시도
      const result = await ensureChromium();
      expect(result.alreadyPresent).toBe(true);
      expect(result.installed).toBe(false);
    } else {
      // playwright 미설치 환경: npx install 시도 mock
      mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
      const result = await ensureChromium();
      expect(result.installed).toBe(true);
      expect(result.alreadyPresent).toBe(false);
    }
  });

  it("chromium 미설치 환경에서 npx playwright install chromium을 호출한다", async () => {
    const chromiumPath = await getChromiumPath();
    if (chromiumPath) {
      // 이미 설치됨 — 이 테스트는 의미 없으므로 건너뜀
      return;
    }

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    await ensureChromium();
    // stdout은 process.stderr로 리다이렉트해 MCP 프로토콜 채널 보호
    expect(mockExeca).toHaveBeenCalledWith(
      "npx",
      ["playwright", "install", "chromium"],
      expect.objectContaining({
        stdin: "ignore",
        stdout: process.stderr,
        stderr: "inherit",
      })
    );
  });

  it("npx playwright install chromium 실패 시 에러를 throw한다", async () => {
    const chromiumPath = await getChromiumPath();
    if (chromiumPath) {
      // 이미 설치됨 — npx 호출 자체를 안 하므로 skip
      return;
    }

    mockExeca.mockRejectedValueOnce(new Error("network error"));
    await expect(ensureChromium()).rejects.toThrow("network error");
  });
});
