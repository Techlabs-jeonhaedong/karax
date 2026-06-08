/**
 * concurrency.ts 단위 테스트
 *
 * pLimit 스타일 동시성 제한 헬퍼 검증:
 * - 결과 순서가 입력 순서와 동일함 (인덱스 보존)
 * - 최대 동시 실행 수를 초과하지 않음
 * - 개별 태스크 실패 시 Promise.all 동작(즉시 reject)
 * - concurrency=1이면 순차 실행과 동일한 결과
 * - 빈 배열 처리
 * - concurrency가 배열 길이보다 크면 모두 동시 실행
 */

import { describe, it, expect, vi } from "vitest";
import { mapConcurrent } from "../concurrency.js";

describe("mapConcurrent", () => {
  it("빈 배열이면 빈 배열을 반환한다", async () => {
    const result = await mapConcurrent([], 4, async (x: number) => x * 2);
    expect(result).toEqual([]);
  });

  it("결과 순서가 입력 인덱스 순서와 동일하다", async () => {
    // 각 태스크가 다른 지연(역순)을 가져도 결과 순서는 보존되어야 한다
    const delays = [50, 10, 30, 5, 20];
    const result = await mapConcurrent(delays, 4, async (delay, idx) => {
      await new Promise((r) => setTimeout(r, delay));
      return idx;
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("concurrency=1이면 순차 실행과 동일한 결과를 반환한다", async () => {
    const order: number[] = [];
    const input = [3, 1, 2];

    await mapConcurrent(input, 1, async (delay, idx) => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(idx);
      return delay * 10;
    });

    // concurrency=1이면 0→1→2 순서로 실행
    expect(order).toEqual([0, 1, 2]);
  });

  it("최대 동시 실행 수를 concurrency 값 이하로 유지한다", async () => {
    const concurrency = 3;
    let running = 0;
    let maxRunning = 0;

    await mapConcurrent(Array.from({ length: 10 }, (_, i) => i), concurrency, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    });

    expect(maxRunning).toBeLessThanOrEqual(concurrency);
  });

  it("각 태스크의 반환값이 결과 배열에 올바르게 담긴다", async () => {
    const result = await mapConcurrent(
      ["a", "b", "c"],
      2,
      async (s) => s.toUpperCase()
    );
    expect(result).toEqual(["A", "B", "C"]);
  });

  it("태스크 중 하나가 reject되면 전체가 reject된다", async () => {
    const fn = vi.fn().mockImplementation(async (n: number) => {
      if (n === 2) throw new Error("task-2-failed");
      return n;
    });

    await expect(
      mapConcurrent([1, 2, 3], 2, fn)
    ).rejects.toThrow("task-2-failed");
  });

  it("concurrency가 배열 길이보다 크면 모두 동시 시작 가능하다", async () => {
    let running = 0;
    let maxRunning = 0;
    const input = [1, 2, 3];

    await mapConcurrent(input, 100, async (n) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return n;
    });

    // 입력 3개, concurrency 100이므로 3개가 동시에 실행 가능
    expect(maxRunning).toBe(3);
  });

  it("concurrency=0이면 직렬 실행(1과 동일)으로 폴백한다", async () => {
    const order: number[] = [];
    await mapConcurrent([10, 5, 1], 0, async (delay, idx) => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(idx);
    });
    expect(order).toEqual([0, 1, 2]);
  });
});
