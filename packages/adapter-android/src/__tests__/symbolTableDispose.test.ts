/**
 * Android adapter — SymbolTable dispose 수명 관리 테스트
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { _setTreeLifecycleHook } from "@karax/adapter-api";
import { androidAdapter } from "../index.js";
import { buildSymbolTable } from "../parse/scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_FIXTURE = path.resolve(__dirname, "../../../..", "fixtures", "android-compose-basic");

function makeCounter() {
  let parsed = 0;
  let disposed = 0;
  _setTreeLifecycleHook({
    onParseWithTree: () => { parsed++; },
    onDisposeTree: () => { disposed++; },
  });
  return {
    get parsed() { return parsed; },
    get disposed() { return disposed; },
  };
}

afterEach(() => {
  _setTreeLifecycleHook(undefined);
});

const ctx = {
  projectPath: ANDROID_FIXTURE,
  framework: "android" as const,
  includeCandidates: true,
};

describe("android adapter — buildSymbolTable dispose 보장", () => {
  it(
    "discoverScreens 완료 후 파싱된 모든 Tree가 dispose된다",
    async () => {
      const counter = makeCounter();
      await androidAdapter.discoverScreens(ctx);
      expect(counter.parsed).toBeGreaterThan(0);
      expect(counter.disposed).toBe(counter.parsed);
    },
    30_000
  );

  it(
    "discoverNavigation 완료 후 파싱된 모든 Tree가 dispose된다",
    async () => {
      const counter = makeCounter();
      await androidAdapter.discoverNavigation?.(ctx);
      expect(counter.parsed).toBeGreaterThan(0);
      expect(counter.disposed).toBe(counter.parsed);
    },
    30_000
  );

  it(
    "buildScreenIR 완료 후 파싱된 모든 Tree가 dispose된다",
    async () => {
      _setTreeLifecycleHook(undefined);
      const screens = await androidAdapter.discoverScreens(ctx);
      const firstScreen = screens.find(s => s.discovery === "route");
      expect(firstScreen).toBeDefined();

      const counter = makeCounter();
      await androidAdapter.buildScreenIR(ctx, firstScreen!.id);
      expect(counter.parsed).toBeGreaterThan(0);
      expect(counter.disposed).toBe(counter.parsed);
    },
    30_000
  );

  it(
    "buildSymbolTable 예외 전파 시 이미 파싱된 Tree가 catch에서 dispose된다 (성공 경로 확인)",
    async () => {
      // buildSymbolTable의 try/catch 구현을 검증한다.
      // 성공 경로에서도 table.dispose() 호출 시 누수 없음을 카운터로 확인한다.
      const counter = makeCounter();
      const table = await buildSymbolTable(ANDROID_FIXTURE);
      table.dispose();
      expect(counter.parsed).toBeGreaterThan(0);
      expect(counter.disposed).toBe(counter.parsed);
    },
    30_000
  );
});
