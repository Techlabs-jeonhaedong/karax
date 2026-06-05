/**
 * React Native adapter — SymbolTable dispose 수명 관리 테스트
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { _setTreeLifecycleHook } from "@karax/adapter-api";
import { reactNativeAdapter } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RN_FIXTURE = path.resolve(__dirname, "../../../..", "fixtures", "react-native-basic");

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
  projectPath: RN_FIXTURE,
  framework: "react-native" as const,
  includeCandidates: true,
};

describe("react-native adapter — buildSymbolTable dispose 보장", () => {
  it(
    "discoverScreens 완료 후 파싱된 모든 Tree가 dispose된다",
    async () => {
      const counter = makeCounter();
      await reactNativeAdapter.discoverScreens(ctx);
      expect(counter.parsed).toBeGreaterThan(0);
      expect(counter.disposed).toBe(counter.parsed);
    },
    30_000
  );

  it(
    "discoverNavigation 완료 후 파싱된 모든 Tree가 dispose된다",
    async () => {
      const counter = makeCounter();
      await reactNativeAdapter.discoverNavigation?.(ctx);
      expect(counter.parsed).toBeGreaterThan(0);
      expect(counter.disposed).toBe(counter.parsed);
    },
    30_000
  );

  it(
    "buildScreenIR 완료 후 파싱된 모든 Tree가 dispose된다",
    async () => {
      _setTreeLifecycleHook(undefined);
      const screens = await reactNativeAdapter.discoverScreens(ctx);
      const firstScreen = screens.find(s => s.discovery === "route");
      expect(firstScreen).toBeDefined();

      const counter = makeCounter();
      await reactNativeAdapter.buildScreenIR(ctx, firstScreen!.id);
      expect(counter.parsed).toBeGreaterThan(0);
      expect(counter.disposed).toBe(counter.parsed);
    },
    30_000
  );

});
