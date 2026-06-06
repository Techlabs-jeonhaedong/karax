/**
 * session.ts 단위 테스트 — 세션 ID 충돌 방지
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-session-test-"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createSessionDir — 세션 ID 형식", () => {
  it("밀리초가 포함된 sessionId를 생성한다", async () => {
    const { createSessionDir } = await import("../session.js");
    const session = createSessionDir(tmpDir);
    // 형식: 2026-06-06T12-34-56-789Z
    expect(session.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  });

  it("생성된 디렉토리가 실제로 존재한다", async () => {
    const { createSessionDir } = await import("../session.js");
    const session = createSessionDir(tmpDir);
    expect(fs.existsSync(session.dir)).toBe(true);
    expect(fs.existsSync(session.screenshotsDir)).toBe(true);
    expect(fs.existsSync(session.appMapDir)).toBe(true);
  });

  it("같은 타임스탬프로 두 번 생성하면 서로 다른 디렉토리를 반환한다", async () => {
    // Date.now()와 new Date()를 동일 값으로 고정
    const fixedDate = new Date("2026-06-06T12:34:56.789Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);

    const { createSessionDir } = await import("../session.js");
    const s1 = createSessionDir(tmpDir);
    const s2 = createSessionDir(tmpDir);

    expect(s1.dir).not.toBe(s2.dir);
    expect(s1.sessionId).not.toBe(s2.sessionId);
    expect(fs.existsSync(s1.dir)).toBe(true);
    expect(fs.existsSync(s2.dir)).toBe(true);
  });

  it("같은 타임스탬프 100회 연속 생성해도 모두 고유한 디렉토리", async () => {
    const fixedDate = new Date("2026-06-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);

    const { createSessionDir } = await import("../session.js");
    const dirs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const session = createSessionDir(tmpDir);
      dirs.add(session.dir);
    }
    expect(dirs.size).toBe(100);
  });

  it("상한(100) 초과 시 에러를 던진다", async () => {
    const fixedDate = new Date("2026-06-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);

    const { createSessionDir } = await import("../session.js");
    // 100개 먼저 생성 (성공해야 함)
    for (let i = 0; i < 100; i++) {
      createSessionDir(tmpDir);
    }
    // 101번째는 에러
    expect(() => createSessionDir(tmpDir)).toThrow();
  });
});
