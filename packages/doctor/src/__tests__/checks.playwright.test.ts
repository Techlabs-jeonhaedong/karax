/**
 * checkPlaywrightChromium 단위 테스트 — 별도 파일로 격리
 *
 * getChromiumPath(playwright Node API 우선)를 mock으로 교체해
 * execa CLI 의존 없이 분기를 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ensure 모듈의 getChromiumPath만 mock으로 교체
vi.mock("../ensure.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../ensure.js")>();
  return {
    ...original,
    getChromiumPath: vi.fn(),
  };
});

import { getChromiumPath } from "../ensure.js";
import { checkPlaywrightChromium } from "../checks/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetChromiumPath = getChromiumPath as any as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkPlaywrightChromium", () => {
  it("ok: chromium 실행파일이 존재하면 status=ok, autoInstallable=true", async () => {
    mockGetChromiumPath.mockResolvedValueOnce(
      "/home/user/.cache/ms-playwright/chromium-1169/chrome-linux/chrome"
    );
    const result = await checkPlaywrightChromium();
    expect(result.id).toBe("playwright-chromium");
    expect(result.status).toBe("ok");
    expect(result.autoInstallable).toBe(true);
  });

  it("missing: getChromiumPath가 null을 반환하면 status=missing", async () => {
    mockGetChromiumPath.mockResolvedValueOnce(null);
    const result = await checkPlaywrightChromium();
    expect(result.status).toBe("missing");
    expect(result.autoInstallable).toBe(true);
  });

  it("getChromiumPath가 throw하면 에러가 전파된다", async () => {
    mockGetChromiumPath.mockRejectedValueOnce(new Error("unexpected"));
    await expect(checkPlaywrightChromium()).rejects.toThrow("unexpected");
  });
});
