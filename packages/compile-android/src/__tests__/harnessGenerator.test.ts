/**
 * 하니스 생성기 단위 테스트 (TDD Red → Green)
 * generateSettingsGradle, generateBuildGradle, generatePaparazziTestKt 등
 */

import { describe, it, expect } from "vitest";
import {
  generateSettingsGradle,
  generateLibsVersionsToml,
  generateHarnessModuleBuildGradle,
  generatePaparazziTestKt,
  deviceConfigForProfile,
} from "../harness/generator.js";

describe("generateSettingsGradle", () => {
  it("pluginManagement에 google + mavenCentral 포함", () => {
    const content = generateSettingsGradle("karax_harness");
    expect(content).toContain("google()");
    expect(content).toContain("mavenCentral()");
  });

  it("rootProject.name 설정 포함", () => {
    const content = generateSettingsGradle("karax_harness");
    expect(content).toContain("rootProject.name");
    expect(content).toContain("karax_harness");
  });

  it("include(':app') 포함", () => {
    const content = generateSettingsGradle("karax_harness");
    expect(content).toContain(":app");
  });
});

describe("generateLibsVersionsToml", () => {
  it("paparazzi 버전 포함", () => {
    const content = generateLibsVersionsToml();
    expect(content).toContain("paparazzi");
  });

  it("agp 버전 포함", () => {
    const content = generateLibsVersionsToml();
    expect(content).toContain("agp");
  });

  it("kotlin 버전 포함", () => {
    const content = generateLibsVersionsToml();
    expect(content).toContain("kotlin");
  });

  it("[versions] 섹션 포함", () => {
    const content = generateLibsVersionsToml();
    expect(content).toContain("[versions]");
  });

  it("[plugins] 섹션 포함", () => {
    const content = generateLibsVersionsToml();
    expect(content).toContain("[plugins]");
  });
});

describe("generateHarnessModuleBuildGradle", () => {
  it("android.library 플러그인 alias 포함", () => {
    const content = generateHarnessModuleBuildGradle({
      packageName: "com.karax.harness",
      sourceAbsPath: "/tmp/source",
    });
    // alias(libs.plugins.android.library) 형태로 포함됨
    expect(content).toContain("android.library");
  });

  it("app.cash.paparazzi 플러그인 포함", () => {
    const content = generateHarnessModuleBuildGradle({
      packageName: "com.karax.harness",
      sourceAbsPath: "/tmp/source",
    });
    expect(content).toContain("paparazzi");
  });

  it("kotlin-android 플러그인 포함", () => {
    const content = generateHarnessModuleBuildGradle({
      packageName: "com.karax.harness",
      sourceAbsPath: "/tmp/source",
    });
    expect(content).toContain("kotlin");
  });

  it("buildFeatures { compose = true } 포함", () => {
    const content = generateHarnessModuleBuildGradle({
      packageName: "com.karax.harness",
      sourceAbsPath: "/tmp/source",
    });
    expect(content).toContain("compose");
  });

  it("packageName이 namespace에 반영됨", () => {
    const content = generateHarnessModuleBuildGradle({
      packageName: "com.example.fixture",
    });
    expect(content).toContain("com.example.fixture");
  });
});

describe("generatePaparazziTestKt", () => {
  it("@get:Rule Paparazzi 포함", () => {
    const code = generatePaparazziTestKt({
      screenName: "HomeScreen",
      packageName: "com.example.fixture.screens",
      testPackageName: "com.karax.harness.test",
      deviceConfig: "NEXUS_5",
      constructorArgs: [],
    });
    expect(code).toContain("@get:Rule");
    expect(code).toContain("Paparazzi");
  });

  it("@Test { paparazzi.snapshot { ... } } 포함", () => {
    const code = generatePaparazziTestKt({
      screenName: "HomeScreen",
      packageName: "com.example.fixture.screens",
      testPackageName: "com.karax.harness.test",
      deviceConfig: "NEXUS_5",
      constructorArgs: [],
    });
    expect(code).toContain("@Test");
    expect(code).toContain("paparazzi.snapshot");
  });

  it("화면 이름이 포함됨", () => {
    const code = generatePaparazziTestKt({
      screenName: "DetailScreen",
      packageName: "com.example.fixture.screens",
      testPackageName: "com.karax.harness.test",
      deviceConfig: "NEXUS_5",
      constructorArgs: [],
    });
    expect(code).toContain("DetailScreen");
  });

  it("import 경로에 packageName 포함", () => {
    const code = generatePaparazziTestKt({
      screenName: "HomeScreen",
      packageName: "com.example.fixture.screens",
      testPackageName: "com.karax.harness.test",
      deviceConfig: "NEXUS_5",
      constructorArgs: [],
    });
    expect(code).toContain("com.example.fixture.screens");
  });

  it("constructorArgs가 화면 호출에 반영됨", () => {
    const code = generatePaparazziTestKt({
      screenName: "HomeScreen",
      packageName: "com.example.fixture.screens",
      testPackageName: "com.karax.harness.test",
      deviceConfig: "NEXUS_5",
      constructorArgs: ["onExploreClick = {}", "onSettingsClick = {}"],
    });
    expect(code).toContain("onExploreClick");
    expect(code).toContain("onSettingsClick");
  });

  it("MaterialTheme 래퍼 포함", () => {
    const code = generatePaparazziTestKt({
      screenName: "HomeScreen",
      packageName: "com.example.fixture.screens",
      testPackageName: "com.karax.harness.test",
      deviceConfig: "NEXUS_5",
      constructorArgs: [],
    });
    // MaterialTheme 또는 AppTheme 래퍼
    expect(code).toMatch(/MaterialTheme|AppTheme/);
  });
});

describe("deviceConfigForProfile", () => {
  it("pixel-8 → PIXEL_6 계열 config 반환", () => {
    const config = deviceConfigForProfile("pixel-8");
    expect(typeof config).toBe("string");
    expect(config.length).toBeGreaterThan(0);
  });

  it("iphone-15 → phone 폴백 반환", () => {
    const config = deviceConfigForProfile("iphone-15");
    expect(typeof config).toBe("string");
  });

  it("generic-tablet → 태블릿 config 반환", () => {
    const config = deviceConfigForProfile("generic-tablet");
    expect(config).toContain("NEXUS_10");
  });

  it("알 수 없는 profile → 기본값 반환", () => {
    const config = deviceConfigForProfile("unknown-device" as never);
    expect(typeof config).toBe("string");
    expect(config.length).toBeGreaterThan(0);
  });
});
