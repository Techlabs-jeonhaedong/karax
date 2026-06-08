/**
 * concurrency.ts — 동시성 제한 헬퍼
 *
 * pLimit 스타일: 최대 concurrency 개의 태스크를 동시에 실행하고
 * 결과 배열의 인덱스 순서를 입력과 동일하게 보존한다.
 *
 * 외부 의존성 없이 순수 Promise로 구현 (결정론적 동작 보장).
 */

/**
 * items 배열의 각 원소에 fn을 적용해 결과 배열을 반환한다.
 *
 * - 최대 concurrency 개의 태스크를 동시에 실행한다.
 * - 결과 배열의 순서는 items 순서와 동일하다 (인덱스 보존).
 * - concurrency <= 0이면 1로 처리한다 (순차 실행).
 * - 태스크 중 하나가 reject되면 즉시 reject한다 (Promise.all 의미론).
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, concurrency);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
