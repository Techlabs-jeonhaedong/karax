/**
 * ensureDependencies — 실패 후 재시도 가능성 회귀 테스트
 *
 * _ensurePromise가 모듈 레벨 싱글턴이므로 vi.resetModules()로
 * 매 테스트마다 모듈을 재로드해 격리한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ensureDependencies — 거부 후 재시도", () => {
  beforeEach(() => {
    // 모듈 캐시를 초기화해 _ensurePromise 싱글턴 리셋
    vi.resetModules();
    // KARAX_SKIP_ENSURE가 설정돼 있으면 early return되므로 제거
    delete process.env.KARAX_SKIP_ENSURE;
  });

  it("첫 호출 실패 후 두 번째 호출은 재시도한다 (영구 차단 안 됨)", async () => {
    let callCount = 0;
    const mockFix = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("network error");
      // 두 번째 호출은 성공
    });

    vi.doMock("@karax/doctor", () => ({
      doctorFix: mockFix,
    }));

    // resetModules 이후 동적 import로 새 모듈 인스턴스 획득
    const { ensureDependencies } = await import("../index.js");

    // 첫 번째 호출: 실패해야 한다
    await expect(ensureDependencies()).rejects.toThrow("network error");

    // 두 번째 호출: 재시도해야 한다 (영구 차단이면 여기서 같은 거부 Promise가 반환됨)
    await expect(ensureDependencies()).resolves.toBeUndefined();

    // doctorFix가 두 번 호출됐는지 확인
    expect(mockFix).toHaveBeenCalledTimes(2);
  });

  it("첫 호출 성공 후 두 번째 호출은 캐시를 재사용한다 (doctorFix 1회만 호출)", async () => {
    const mockFix = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@karax/doctor", () => ({
      doctorFix: mockFix,
    }));

    const { ensureDependencies } = await import("../index.js");

    await ensureDependencies();
    await ensureDependencies();

    expect(mockFix).toHaveBeenCalledTimes(1);
  });

  it("연속 실패 후 성공 시 정상 동작", async () => {
    let callCount = 0;
    const mockFix = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) throw new Error(`fail #${callCount}`);
    });

    vi.doMock("@karax/doctor", () => ({
      doctorFix: mockFix,
    }));

    const { ensureDependencies } = await import("../index.js");

    await expect(ensureDependencies()).rejects.toThrow("fail #1");
    await expect(ensureDependencies()).rejects.toThrow("fail #2");
    await expect(ensureDependencies()).resolves.toBeUndefined();
    expect(mockFix).toHaveBeenCalledTimes(3);
  });
});
