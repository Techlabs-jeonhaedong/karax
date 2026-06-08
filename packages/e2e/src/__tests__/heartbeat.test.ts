/**
 * withHeartbeat 단위 테스트
 *
 * - intervalMs마다 makeEvent()로 만든 이벤트가 callback에 전달되는지
 * - promise resolve 후 타이머가 정리되는지
 * - promise reject 시 동일 에러로 reject되고 타이머가 정리되는지
 * - callback이 throw해도 withHeartbeat가 정상 결과를 반환하는지
 * - callback이 undefined여도 promise 결과를 그대로 반환하는지
 * - (단조성 회귀) heartbeat 이벤트의 status가 "start"이고 phase가 "build"인지
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { E2eProgressCallback, E2eProgressEvent } from "../progress.js";
import { withHeartbeat } from "../progress.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeEvent(): E2eProgressEvent {
  return {
    phase: "build",
    status: "start",
    timestamp: Date.now(),
    heartbeat: true,
    detail: "진행 중…",
  };
}

// ── 기본 heartbeat 발행 ──────────────────────────────────────────────

describe("withHeartbeat — 기본 heartbeat 발행", () => {
  it("intervalMs마다 callback에 makeEvent 결과가 전달된다", async () => {
    let resolveP!: (v: string) => void;
    const promise = new Promise<string>((res) => {
      resolveP = res;
    });

    const events: E2eProgressEvent[] = [];
    const callback: E2eProgressCallback = (e) => {
      events.push(e);
    };

    const resultPromise = withHeartbeat(promise, callback, makeEvent, 1000);

    // 1초 경과 → 1번 발행
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(1);

    // 2초 경과 → 2번 발행
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(2);

    // 3초 경과 → 3번 발행
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(3);

    resolveP("done");
    expect(await resultPromise).toBe("done");
  });

  it("promise resolve 이후로는 더 이상 heartbeat가 발행되지 않는다", async () => {
    let resolveP!: (v: number) => void;
    const promise = new Promise<number>((res) => {
      resolveP = res;
    });

    const events: E2eProgressEvent[] = [];
    const callback: E2eProgressCallback = (e) => {
      events.push(e);
    };

    const resultPromise = withHeartbeat(promise, callback, makeEvent, 1000);

    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toHaveLength(2);

    // resolve 후 타이머 정리
    resolveP(42);
    await resultPromise;

    // resolve 이후에 타이머가 남아있으면 이 이벤트가 추가됨 — 추가되면 안 됨
    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toHaveLength(2);
  });

  it("promise resolve 결과가 그대로 반환된다", async () => {
    const promise = Promise.resolve("result-value");
    const callback: E2eProgressCallback = vi.fn();

    const result = await withHeartbeat(promise, callback, makeEvent, 1000);
    expect(result).toBe("result-value");
  });
});

// ── reject / 에러 전파 ───────────────────────────────────────────────

describe("withHeartbeat — reject 전파 및 타이머 정리", () => {
  it("promise reject 시 동일 에러로 reject된다", async () => {
    const err = new Error("빌드 실패");
    const promise = Promise.reject<string>(err);

    const callback: E2eProgressCallback = vi.fn();

    await expect(withHeartbeat(promise, callback, makeEvent, 1000)).rejects.toThrow("빌드 실패");
  });

  it("promise reject 이후로는 heartbeat가 발행되지 않는다", async () => {
    let rejectP!: (e: unknown) => void;
    const promise = new Promise<string>((_, rej) => {
      rejectP = rej;
    });

    const events: E2eProgressEvent[] = [];
    const callback: E2eProgressCallback = (e) => {
      events.push(e);
    };

    const resultPromise = withHeartbeat(promise, callback, makeEvent, 1000);
    // unhandled rejection 방지
    resultPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(1);

    rejectP(new Error("실패"));
    // promise reject 처리 microtask 기다림
    await vi.advanceTimersByTimeAsync(0);

    // reject 이후 타이머 tick — 발행되면 안 됨
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(1);
  });
});

// ── callback 오류 격리 ───────────────────────────────────────────────

describe("withHeartbeat — callback 오류 격리", () => {
  it("callback이 동기 throw해도 withHeartbeat가 정상 결과를 반환한다", async () => {
    const promise = Promise.resolve("ok");

    const throwingCallback: E2eProgressCallback = () => {
      throw new Error("callback 오류");
    };

    // callback throw가 있어도 정상 결과를 반환해야 함
    const result = await withHeartbeat(promise, throwingCallback, makeEvent, 100);
    expect(result).toBe("ok");
  });

  it("callback이 async throw해도 withHeartbeat가 정상 결과를 반환한다", async () => {
    let resolveP!: (v: string) => void;
    const promise = new Promise<string>((res) => {
      resolveP = res;
    });

    const asyncThrowingCallback: E2eProgressCallback = async () => {
      await Promise.resolve();
      throw new Error("async callback 오류");
    };

    const resultPromise = withHeartbeat(promise, asyncThrowingCallback, makeEvent, 500);

    await vi.advanceTimersByTimeAsync(500);
    // callback throw 후 microtask 처리
    await vi.advanceTimersByTimeAsync(0);

    resolveP("success");
    const result = await resultPromise;
    expect(result).toBe("success");
  });
});

// ── callback undefined ───────────────────────────────────────────────

describe("withHeartbeat — callback undefined", () => {
  it("callback이 undefined여도 promise 결과를 그대로 반환한다", async () => {
    const promise = Promise.resolve(99);

    const result = await withHeartbeat(promise, undefined, makeEvent, 1000);
    expect(result).toBe(99);
  });

  it("callback이 undefined면 타이머를 생성하지 않는다 (setInterval 미호출)", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const promise = Promise.resolve("value");

    await withHeartbeat(promise, undefined, makeEvent, 1000);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("callback이 undefined고 promise reject이면 에러를 그대로 전파한다", async () => {
    const promise = Promise.reject<string>(new Error("reject"));

    await expect(withHeartbeat(promise, undefined, makeEvent, 1000)).rejects.toThrow("reject");
  });
});

// ── 단조성 회귀 ──────────────────────────────────────────────────────

describe("withHeartbeat — 단조성 회귀 (build heartbeat status)", () => {
  it("heartbeat 이벤트의 status가 'start'이고 phase가 'build'다", async () => {
    let resolveP!: (v: void) => void;
    const promise = new Promise<void>((res) => {
      resolveP = res;
    });

    const events: E2eProgressEvent[] = [];
    const callback: E2eProgressCallback = (e) => {
      events.push(e);
    };

    const resultPromise = withHeartbeat(promise, callback, makeEvent, 500);

    await vi.advanceTimersByTimeAsync(1500); // 3번 tick
    resolveP();
    await resultPromise;

    // 모든 heartbeat 이벤트의 status는 "start", phase는 "build"
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.status).toBe("start");
      expect(e.phase).toBe("build");
    }
  });

  it("heartbeat 이벤트는 heartbeat:true, status:'start', phase:'build', detail:'진행 중…'이다", async () => {
    let resolveP!: (v: void) => void;
    const promise = new Promise<void>((res) => {
      resolveP = res;
    });

    const events: E2eProgressEvent[] = [];
    const callback: E2eProgressCallback = (e) => {
      events.push(e);
    };

    const resultPromise = withHeartbeat(promise, callback, makeEvent, 500);

    // 실제 tick 발생: 500ms 경과 → 1번 이상 발행
    await vi.advanceTimersByTimeAsync(1000); // 2번 tick
    resolveP();
    await resultPromise;

    // 최소 1개 이상 이벤트가 발행되었음을 보장
    expect(events.length).toBeGreaterThan(0);
    // 모든 heartbeat 이벤트 필드 단언
    for (const e of events) {
      expect(e.heartbeat).toBe(true);
      expect(e.status).toBe("start");
      expect(e.phase).toBe("build");
      expect(e.detail).toBe("진행 중…");
    }
  });
});

// ── 기본값 intervalMs ────────────────────────────────────────────────

describe("withHeartbeat — 기본 intervalMs", () => {
  it("intervalMs를 생략하면 20_000ms마다 발행된다", async () => {
    let resolveP!: (v: void) => void;
    const promise = new Promise<void>((res) => {
      resolveP = res;
    });

    const events: E2eProgressEvent[] = [];
    const callback: E2eProgressCallback = (e) => {
      events.push(e);
    };

    const resultPromise = withHeartbeat(promise, callback, makeEvent);

    // 19초 경과 → 아직 발행 안 됨
    await vi.advanceTimersByTimeAsync(19_000);
    expect(events).toHaveLength(0);

    // 20초 경과 → 1번 발행
    await vi.advanceTimersByTimeAsync(1_000);
    expect(events).toHaveLength(1);

    resolveP();
    await resultPromise;
  });
});
