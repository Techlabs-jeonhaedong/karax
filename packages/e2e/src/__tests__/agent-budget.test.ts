/**
 * agent/budget.ts 단위 테스트
 * computeBudget 순수 함수 — budget 자동 조정 로직
 */

import { describe, it, expect } from "vitest";
import { computeBudget } from "../agent/budget.js";
import type { BudgetInput } from "../agent/budget.js";

describe("computeBudget", () => {
  // ── 사용자 명시값 우선 ────────────────────────────────────────────────

  describe("사용자 명시값 우선", () => {
    it("userMaxSteps가 있으면 계산값을 무시하고 그대로 반환한다", () => {
      const budget = computeBudget({
        screenCount: 20,
        exploratory: true,
        userMaxSteps: 50,
      });
      expect(budget.maxSteps).toBe(50);
    });

    it("userTimeoutMs가 있으면 계산값을 무시하고 그대로 반환한다", () => {
      const budget = computeBudget({
        screenCount: 20,
        exploratory: true,
        userTimeoutMs: 1_800_000,
      });
      expect(budget.timeoutMs).toBe(1_800_000);
    });

    it("userMaxSteps와 userTimeoutMs 모두 있으면 둘 다 그대로 반환한다", () => {
      const budget = computeBudget({
        screenCount: 10,
        exploratory: true,
        userMaxSteps: 5,
        userTimeoutMs: 300_000,
      });
      expect(budget.maxSteps).toBe(5);
      expect(budget.timeoutMs).toBe(300_000);
    });

    it("userMaxSteps만 명시 시 timeoutMs는 자동 계산된다", () => {
      const budget = computeBudget({
        screenCount: 10,
        exploratory: true,
        userMaxSteps: 99,
      });
      // userMaxSteps만 명시 → maxSteps는 99, timeoutMs는 자동 (10*60_000 = 600_000)
      expect(budget.maxSteps).toBe(99);
      expect(budget.timeoutMs).toBe(900_000); // clamp 하한 = 900_000
    });

    it("userTimeoutMs만 명시 시 maxSteps는 자동 계산된다", () => {
      const budget = computeBudget({
        screenCount: 10,
        exploratory: true,
        userTimeoutMs: 99_999,
      });
      // userTimeoutMs만 명시 → timeoutMs는 99_999, maxSteps는 자동 (10*3=30)
      expect(budget.timeoutMs).toBe(99_999);
      expect(budget.maxSteps).toBe(30);
    });
  });

  // ── exploratory + screenCount 비례 ──────────────────────────────────

  describe("exploratory + screenCount > 0 비례 계산", () => {
    it("screenCount 5 → maxSteps = 15 (5*3=15, clamp[20,60] 하한 미달 → 20)", () => {
      const budget = computeBudget({ screenCount: 5, exploratory: true });
      expect(budget.maxSteps).toBe(20);
    });

    it("screenCount 10 → maxSteps = 30 (10*3=30, clamp[20,60] 범위 내)", () => {
      const budget = computeBudget({ screenCount: 10, exploratory: true });
      expect(budget.maxSteps).toBe(30);
    });

    it("screenCount 100 → maxSteps = 60 (100*3=300, clamp[20,60] 상한 → 60)", () => {
      const budget = computeBudget({ screenCount: 100, exploratory: true });
      expect(budget.maxSteps).toBe(60);
    });

    it("screenCount 3 → maxSteps = 20 (3*3=9, clamp 하한 → 20)", () => {
      const budget = computeBudget({ screenCount: 3, exploratory: true });
      expect(budget.maxSteps).toBe(20);
    });

    it("screenCount 7 → timeoutMs = 900_000 (7*60_000=420_000, clamp[900_000,2_400_000] 하한 → 900_000)", () => {
      const budget = computeBudget({ screenCount: 7, exploratory: true });
      expect(budget.timeoutMs).toBe(900_000);
    });

    it("screenCount 20 → timeoutMs = 1_200_000 (20*60_000=1_200_000, 범위 내)", () => {
      const budget = computeBudget({ screenCount: 20, exploratory: true });
      expect(budget.timeoutMs).toBe(1_200_000);
    });

    it("screenCount 50 → timeoutMs = 2_400_000 (50*60_000=3_000_000, clamp 상한 → 2_400_000)", () => {
      const budget = computeBudget({ screenCount: 50, exploratory: true });
      expect(budget.timeoutMs).toBe(2_400_000);
    });

    it("screenCount 40 → timeoutMs = 2_400_000 (40*60_000=2_400_000, 상한 경계값)", () => {
      const budget = computeBudget({ screenCount: 40, exploratory: true });
      expect(budget.timeoutMs).toBe(2_400_000);
    });
  });

  // ── 시나리오 모드 기본값 ─────────────────────────────────────────────

  describe("시나리오 모드 (exploratory=false) — 기본값 반환", () => {
    it("screenCount가 있어도 exploratory=false면 기본값을 반환한다", () => {
      const budget = computeBudget({ screenCount: 30, exploratory: false });
      expect(budget.maxSteps).toBe(20);
      expect(budget.timeoutMs).toBe(900_000);
    });

    it("사용자 명시값이 있으면 시나리오 모드에서도 우선 적용된다", () => {
      const budget = computeBudget({
        screenCount: 30,
        exploratory: false,
        userMaxSteps: 15,
        userTimeoutMs: 600_000,
      });
      expect(budget.maxSteps).toBe(15);
      expect(budget.timeoutMs).toBe(600_000);
    });
  });

  // ── screenCount 0 기본값 ─────────────────────────────────────────────

  describe("screenCount 0 (AppMap 없음) — 기본값 반환", () => {
    it("exploratory이지만 screenCount=0이면 기본값을 반환한다", () => {
      const budget = computeBudget({ screenCount: 0, exploratory: true });
      expect(budget.maxSteps).toBe(20);
      expect(budget.timeoutMs).toBe(900_000);
    });

    it("screenCount=0 + exploratory=false도 기본값", () => {
      const budget = computeBudget({ screenCount: 0, exploratory: false });
      expect(budget.maxSteps).toBe(20);
      expect(budget.timeoutMs).toBe(900_000);
    });
  });

  // ── 반환 타입 구조 ───────────────────────────────────────────────────

  describe("반환 타입", () => {
    it("Budget 인터페이스에 맞는 객체를 반환한다", () => {
      const budget = computeBudget({ screenCount: 10, exploratory: true });
      expect(typeof budget.maxSteps).toBe("number");
      expect(typeof budget.timeoutMs).toBe("number");
      expect(Object.keys(budget)).toEqual(expect.arrayContaining(["maxSteps", "timeoutMs"]));
    });

    it("모든 값이 양의 정수다", () => {
      const budget = computeBudget({ screenCount: 15, exploratory: true });
      expect(budget.maxSteps).toBeGreaterThan(0);
      expect(budget.timeoutMs).toBeGreaterThan(0);
      expect(Number.isInteger(budget.maxSteps)).toBe(true);
      expect(Number.isInteger(budget.timeoutMs)).toBe(true);
    });
  });
});
