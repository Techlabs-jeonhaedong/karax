import type { CheckResult } from "./checks/types.js";

export interface FrameworkTier {
  tier1: boolean;
  tier2: true;
  missing: string[];
}

export interface TiersAvailable {
  flutter: FrameworkTier;
  "react-native": FrameworkTier;
  android: FrameworkTier;
  ios: FrameworkTier;
}

function isOk(checks: CheckResult[], id: string): boolean {
  const c = checks.find((x) => x.id === id);
  return c?.status === "ok";
}

export function computeTiers(checks: CheckResult[]): TiersAvailable {
  const flutter = computeFlutter(checks);
  const reactNative = computeReactNative(checks);
  const android = computeAndroid(checks);
  const ios = computeIos(checks);

  return { flutter, "react-native": reactNative, android, ios };
}

function computeFlutter(checks: CheckResult[]): FrameworkTier {
  const missing: string[] = [];
  if (!isOk(checks, "flutter")) missing.push("flutter");

  return { tier1: missing.length === 0, tier2: true, missing };
}

function computeReactNative(checks: CheckResult[]): FrameworkTier {
  // node + esbuild(워크스페이스 내장, 항상 ok)
  const missing: string[] = [];
  if (!isOk(checks, "node")) missing.push("node");

  return { tier1: missing.length === 0, tier2: true, missing };
}

function computeAndroid(checks: CheckResult[]): FrameworkTier {
  const missing: string[] = [];
  if (!isOk(checks, "java")) missing.push("java");
  if (!isOk(checks, "gradle")) missing.push("gradle");
  if (!isOk(checks, "android-sdk")) missing.push("android-sdk");

  return { tier1: missing.length === 0, tier2: true, missing };
}

function computeIos(checks: CheckResult[]): FrameworkTier {
  const missing: string[] = [];
  if (!isOk(checks, "xcodebuild")) missing.push("xcodebuild");

  return { tier1: missing.length === 0, tier2: true, missing };
}
