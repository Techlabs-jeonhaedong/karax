/**
 * build/detect.ts 단위 테스트
 */

import { describe, it, expect } from "vitest";
import {
  detectGradleAppModule,
  parseXcodebuildListJson,
  selectXcodeScheme,
} from "../build/detect.js";

// ── detectGradleAppModule ─────────────────────────────────────────

describe("detectGradleAppModule", () => {
  it("settings.gradle에서 ':app' include를 탐지한다", () => {
    const settingsContent = `rootProject.name = 'MyApp'\ninclude ':app'`;
    const result = detectGradleAppModule(settingsContent, null);
    expect(result).toBe("app");
  });

  it("여러 모듈 중 application 플러그인 가진 모듈명 반환 (build.gradle 힌트)", () => {
    const settingsContent = `include ':app', ':library'`;
    const buildGradleContent = `apply plugin: 'com.android.application'`;
    const result = detectGradleAppModule(settingsContent, buildGradleContent);
    expect(result).toBe("app");
  });

  it("':app'이 없으면 첫 번째 모듈 반환", () => {
    const settingsContent = `include ':feature', ':lib'`;
    const result = detectGradleAppModule(settingsContent, null);
    expect(result).toBe("feature");
  });

  it("빈 settings.gradle이면 'app' 기본값 반환", () => {
    const result = detectGradleAppModule("", null);
    expect(result).toBe("app");
  });

  it("settings.gradle.kts 형식도 지원", () => {
    const settingsContent = `include(":app")\ninclude(":feature")`;
    const result = detectGradleAppModule(settingsContent, null);
    expect(result).toBe("app");
  });
});

// ── parseXcodebuildListJson ────────────────────────────────────────

describe("parseXcodebuildListJson", () => {
  it("정상 JSON에서 schemes를 파싱한다", () => {
    const json = JSON.stringify({
      project: {
        schemes: ["MyApp", "MyAppTests"],
        targets: ["MyApp"],
      },
    });
    const result = parseXcodebuildListJson(json);
    expect(result.schemes).toEqual(["MyApp", "MyAppTests"]);
  });

  it("workspace 형식도 지원한다", () => {
    const json = JSON.stringify({
      workspace: {
        schemes: ["AppScheme", "WidgetScheme"],
      },
    });
    const result = parseXcodebuildListJson(json);
    expect(result.schemes).toEqual(["AppScheme", "WidgetScheme"]);
  });

  it("유효하지 않은 JSON이면 빈 schemes 반환", () => {
    const result = parseXcodebuildListJson("not-json");
    expect(result.schemes).toEqual([]);
  });

  it("schemes 키 없으면 빈 배열 반환", () => {
    const result = parseXcodebuildListJson(JSON.stringify({ project: { targets: [] } }));
    expect(result.schemes).toEqual([]);
  });
});

// ── selectXcodeScheme ──────────────────────────────────────────────

describe("selectXcodeScheme", () => {
  it("Tests/Widget/Extension 제외 후 첫 번째 선택", () => {
    const schemes = ["MyAppTests", "MyAppWidget", "MyApp", "MyAppExtension"];
    expect(selectXcodeScheme(schemes)).toBe("MyApp");
  });

  it("스킴이 하나면 그것을 반환", () => {
    expect(selectXcodeScheme(["OnlyScheme"])).toBe("OnlyScheme");
  });

  it("빈 배열이면 null 반환", () => {
    expect(selectXcodeScheme([])).toBeNull();
  });

  it("모두 Test 스킴이면 첫 번째 반환", () => {
    expect(selectXcodeScheme(["AppTests", "AppUITests"])).toBe("AppTests");
  });
});
