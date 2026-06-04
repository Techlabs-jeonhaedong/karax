/**
 * tiers.ts — 프레임워크별 가용 티어 판정 테스트
 */

import { describe, it, expect } from "vitest";
import type { CheckResult } from "../checks/types.js";
import { computeTiers } from "../tiers.js";

function check(id: string, status: CheckResult["status"]): CheckResult {
  return {
    id,
    label: id,
    status,
    autoInstallable: false,
    hint: "",
  };
}

const ok = (id: string) => check(id, "ok");
const missing = (id: string) => check(id, "missing");
const outdated = (id: string) => check(id, "outdated");

// ─── Flutter ─────────────────────────────────────────────────────────────────

describe("computeTiers — Flutter", () => {
  it("flutter ok → tier1=true", () => {
    const checks = [ok("flutter"), ok("dart"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.flutter.tier1).toBe(true);
    expect(tiers.flutter.tier2).toBe(true);
    expect(tiers.flutter.missing).toEqual([]);
  });

  it("flutter missing → tier1=false, missing에 flutter 포함", () => {
    const checks = [missing("flutter"), ok("dart"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.flutter.tier1).toBe(false);
    expect(tiers.flutter.missing).toContain("flutter");
  });

  it("flutter outdated → tier1=false, missing에 flutter 포함", () => {
    const checks = [outdated("flutter"), ok("dart"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.flutter.tier1).toBe(false);
    expect(tiers.flutter.missing).toContain("flutter");
  });
});

// ─── React Native ─────────────────────────────────────────────────────────────

describe("computeTiers — React Native", () => {
  it("node ok → tier1=true (esbuild은 워크스페이스 내장이라 항상 ok)", () => {
    const checks = [ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers["react-native"].tier1).toBe(true);
    expect(tiers["react-native"].tier2).toBe(true);
    expect(tiers["react-native"].missing).toEqual([]);
  });

  it("node missing → tier1=false", () => {
    const checks = [missing("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers["react-native"].tier1).toBe(false);
    expect(tiers["react-native"].missing).toContain("node");
  });

  it("node outdated → tier1=false", () => {
    const checks = [outdated("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers["react-native"].tier1).toBe(false);
  });
});

// ─── Android ─────────────────────────────────────────────────────────────────

describe("computeTiers — Android", () => {
  it("java + gradle ok → tier1=true", () => {
    const checks = [ok("java"), ok("gradle"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.android.tier1).toBe(true);
    expect(tiers.android.missing).toEqual([]);
  });

  it("java missing → tier1=false, missing에 java 포함", () => {
    const checks = [missing("java"), ok("gradle"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.android.tier1).toBe(false);
    expect(tiers.android.missing).toContain("java");
  });

  it("gradle missing → tier1=false, missing에 gradle 포함", () => {
    const checks = [ok("java"), missing("gradle"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.android.tier1).toBe(false);
    expect(tiers.android.missing).toContain("gradle");
  });

  it("java outdated (JDK<11) → tier1=false", () => {
    const checks = [outdated("java"), ok("gradle"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.android.tier1).toBe(false);
  });
});

// ─── iOS ─────────────────────────────────────────────────────────────────────

describe("computeTiers — iOS", () => {
  it("xcodebuild ok (darwin) → tier1=true", () => {
    const checks = [ok("xcodebuild"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.ios.tier1).toBe(true);
    expect(tiers.ios.missing).toEqual([]);
  });

  it("xcodebuild missing → tier1=false", () => {
    const checks = [missing("xcodebuild"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.ios.tier1).toBe(false);
    expect(tiers.ios.missing).toContain("xcodebuild");
  });

  it("xcodebuild outdated → tier1=false", () => {
    const checks = [outdated("xcodebuild"), ok("node"), ok("playwright-chromium")];
    const tiers = computeTiers(checks);
    expect(tiers.ios.tier1).toBe(false);
  });
});

// ─── tier2 항상 true ─────────────────────────────────────────────────────────

describe("tier2 항상 true (모든 프레임워크)", () => {
  it("모든 체크 missing이어도 tier2=true", () => {
    const checks = [
      missing("flutter"), missing("dart"), missing("node"),
      missing("playwright-chromium"), missing("java"), missing("gradle"),
      missing("xcodebuild"),
    ];
    const tiers = computeTiers(checks);
    expect(tiers.flutter.tier2).toBe(true);
    expect(tiers["react-native"].tier2).toBe(true);
    expect(tiers.android.tier2).toBe(true);
    expect(tiers.ios.tier2).toBe(true);
  });
});
