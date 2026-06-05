/**
 * agent/prompt.ts 단위 테스트
 */

import { describe, it, expect } from "vitest";
import { buildAgentPrompt } from "../agent/prompt.js";
import type { Platform } from "../types.js";

const baseOpts = {
  platform: "android" as Platform,
  deviceId: "emulator-5554",
  appId: "com.example.app",
  screenshotsDir: "/tmp/e2e/screenshots",
  maxSteps: 20,
};

describe("buildAgentPrompt", () => {
  it("deviceId가 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("emulator-5554");
  });

  it("appId가 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("com.example.app");
  });

  it("screenshotsDir 절대경로가 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("/tmp/e2e/screenshots");
  });

  it("maxSteps가 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("20");
  });

  it("result.json 출력 계약이 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("result.json");
  });

  it("outcome 필드 계약이 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("outcome");
  });

  it("탐색 모드에서 exploratory 지시가 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result.toLowerCase()).toMatch(/explor|탐색/);
  });

  it("시나리오 모드에서 body가 포함된다", () => {
    const result = buildAgentPrompt({
      ...baseOpts,
      exploratory: false,
      scenarioBody: "로그인 버튼을 탭하고 성공을 확인한다",
    });
    expect(result).toContain("로그인 버튼을 탭하고 성공을 확인한다");
  });

  it("android 플랫폼에서 adb 치트시트가 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("adb");
  });

  it("ios 플랫폼에서 simctl 치트시트가 포함된다", () => {
    const result = buildAgentPrompt({
      ...baseOpts,
      platform: "ios",
      exploratory: true,
    });
    expect(result).toContain("simctl");
  });

  it("steps 구조(index/description/status/screenshot) 계약이 포함된다", () => {
    const result = buildAgentPrompt({ ...baseOpts, exploratory: true });
    expect(result).toContain("steps");
    expect(result).toContain("screenshot");
  });
});
