/**
 * checkAndroidSdk 단위 테스트
 * fs/promises.access를 vi.mock으로 격리한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  access: vi.fn(),
}));

import { access } from "fs/promises";
import { checkAndroidSdk } from "../checks/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAccess = access as any as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: 모든 경로 없음
  mockAccess.mockRejectedValue(new Error("ENOENT"));
});

describe("checkAndroidSdk", () => {
  it("id가 android-sdk 이어야 함", async () => {
    const result = await checkAndroidSdk();
    expect(result.id).toBe("android-sdk");
  });

  it("autoInstallable=false", async () => {
    const result = await checkAndroidSdk();
    expect(result.autoInstallable).toBe(false);
  });

  it("SDK 없음 → status=missing", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    const result = await checkAndroidSdk();
    expect(result.status).toBe("missing");
  });

  it("platform-tools 포함 경로 접근 가능 → status=ok, version=경로", async () => {
    // 첫 번째 후보(ANDROID_HOME)에 대해 두 번 접근 성공(루트 + platform-tools)
    mockAccess.mockResolvedValue(undefined);
    const result = await checkAndroidSdk();
    expect(result.status).toBe("ok");
    expect(result.version).toBeTruthy();
  });

  it("hint 문자열이 비어있지 않음", async () => {
    const result = await checkAndroidSdk();
    expect(result.hint).toBeTruthy();
    expect(result.hint.length).toBeGreaterThan(0);
  });

  it("label이 비어있지 않음", async () => {
    const result = await checkAndroidSdk();
    expect(result.label).toBeTruthy();
  });
});
