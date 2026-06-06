/**
 * agent/budget.ts — AppMap 화면 수 기반 budget 자동 조정 (순수 함수)
 */

/** exploratory 모드에서 화면당 최대 스텝 배율 */
const STEPS_PER_SCREEN = 3;

/** maxSteps 하한 (최소 보장 스텝 수) */
const MIN_STEPS = 20;
/** maxSteps 상한 (과도한 소비 방지) */
const MAX_STEPS = 60;

/** timeoutMs 하한 (최소 15분) — 단위: ms */
const MIN_TIMEOUT_MS = 900_000;
/** timeoutMs 상한 (최대 40분) — 단위: ms. timeoutMs는 에이전트 시도 1회당이며 검증 실패 재시도 포함 최악 2배 소요 가능. */
const MAX_TIMEOUT_MS = 2_400_000;

/** 화면 1개당 할당 시간 (1분) — 단위: ms */
const TIMEOUT_MS_PER_SCREEN = 60_000;

export interface BudgetInput {
  /** AppMap 화면 수. AppMap 없으면 0 */
  screenCount: number;
  /** exploratory 모드 여부 */
  exploratory: boolean;
  /**
   * 사용자가 명시한 maxSteps.
   * 있으면 계산값보다 항상 우선 적용된다.
   */
  userMaxSteps?: number;
  /**
   * 사용자가 명시한 timeoutMs.
   * 있으면 계산값보다 항상 우선 적용된다.
   */
  userTimeoutMs?: number;
}

export interface Budget {
  maxSteps: number;
  timeoutMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * AppMap 화면 수와 실행 모드를 기반으로 에이전트 실행 예산을 결정한다.
 *
 * 우선순위:
 * 1. 사용자 명시값 (각 필드 독립적으로 적용)
 * 2. exploratory + screenCount>0 → 비례 계산 + clamp
 * 3. 그 외(시나리오 모드 또는 screenCount=0) → 기본값
 */
export function computeBudget(input: BudgetInput): Budget {
  const { screenCount, exploratory, userMaxSteps, userTimeoutMs } = input;

  const useProportional = exploratory && screenCount > 0;

  const maxSteps =
    userMaxSteps !== undefined
      ? userMaxSteps
      : useProportional
        ? clamp(screenCount * STEPS_PER_SCREEN, MIN_STEPS, MAX_STEPS)
        : MIN_STEPS;

  const timeoutMs =
    userTimeoutMs !== undefined
      ? userTimeoutMs
      : useProportional
        ? clamp(screenCount * TIMEOUT_MS_PER_SCREEN, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
        : MIN_TIMEOUT_MS;

  return { maxSteps, timeoutMs };
}
