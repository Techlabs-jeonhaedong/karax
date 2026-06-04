import { describe, expect, it } from "vitest";
import { generatePubspec, generateTestDart, getBuiltinFontsDir } from "../harness/generator.js";
import type { ScreenSummary } from "@sfc/adapter-api";
import type { ConstructorParam } from "../harness/paramCodegen.js";

// ── 공통 픽스처 ────────────────────────────────────────────────────────────────

const BASE_SCREEN: ScreenSummary = {
  id: "HomeScreen",
  title: "Home Screen",
  discovery: "route",
  confidence: 1.0,
  sourceRef: {
    file: "lib/screens/home_screen.dart",
    line: 7,
    symbol: "HomeScreen",
  },
};

// 실제 폰트 디렉토리 (packages/compile-flutter/assets/fonts)
const FONTS_DIR = getBuiltinFontsDir();

// ── pubspec.yaml 생성 테스트 ───────────────────────────────────────────────────

describe("generatePubspec", () => {
  it("대상 앱 path dependency를 포함해야 한다", () => {
    const yaml = generatePubspec({
      appPackageName: "flutter_basic_fixture",
      appAbsolutePath: "/abs/path/to/app",
      fontsDir: FONTS_DIR,
    });
    expect(yaml).toContain("flutter_basic_fixture:");
    expect(yaml).toContain("path: /abs/path/to/app");
  });

  it("flutter_test dev dependency를 포함해야 한다", () => {
    const yaml = generatePubspec({
      appPackageName: "flutter_basic_fixture",
      appAbsolutePath: "/abs/path/to/app",
      fontsDir: FONTS_DIR,
    });
    expect(yaml).toContain("flutter_test:");
    expect(yaml).toContain("sdk: flutter");
  });

  it("Roboto 폰트 asset을 선언해야 한다", () => {
    const yaml = generatePubspec({
      appPackageName: "flutter_basic_fixture",
      appAbsolutePath: "/abs/path/to/app",
      fontsDir: FONTS_DIR,
    });
    expect(yaml).toContain("fonts:");
    expect(yaml).toContain("Roboto");
  });

  it("harness 패키지명은 sfc_harness여야 한다", () => {
    const yaml = generatePubspec({
      appPackageName: "flutter_basic_fixture",
      appAbsolutePath: "/abs/path/to/app",
      fontsDir: FONTS_DIR,
    });
    expect(yaml).toContain("name: sfc_harness");
  });
});

// ── test/screen_capture_test.dart 생성 테스트 ──────────────────────────────────

describe("generateTestDart", () => {
  const NO_PARAMS: ConstructorParam[] = [];

  it("screen id로 테스트 파일명/그룹을 생성해야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "iphone-15",
      goldenFileName: "HomeScreen.png",
    });
    expect(dart).toContain("HomeScreen");
    expect(dart).toContain("'HomeScreen.png'");
  });

  it("대상 화면을 import해야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "iphone-15",
      goldenFileName: "HomeScreen.png",
    });
    expect(dart).toContain("package:flutter_basic_fixture/screens/home_screen.dart");
  });

  it("iphone-15 디바이스 크기(390x844 논리픽셀, dpr=3)를 설정해야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "iphone-15",
      goldenFileName: "HomeScreen.png",
    });
    // 논리픽셀 390*3=1170, 844*3=2532 물리픽셀
    expect(dart).toContain("1170");
    expect(dart).toContain("2532");
    // dpr은 숫자로 표현 (3 또는 3.0)
    expect(dart).toMatch(/devicePixelRatio = 3/);
  });

  it("pixel-8 디바이스 크기를 설정해야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "pixel-8",
      goldenFileName: "HomeScreen.png",
    });
    // pixel-8: 412x915 논리픽셀, dpr=2.625 → Math.round(412*2.625)=1082, Math.round(915*2.625)=2402
    expect(dart).toContain("1082");
    expect(dart).toContain("2402");
  });

  it("required 파라미터 없는 화면은 const 생성자로 호출해야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "iphone-15",
      goldenFileName: "HomeScreen.png",
    });
    expect(dart).toContain("const HomeScreen()");
  });

  it("required String 파라미터가 있으면 mock 문자열을 주입해야 한다", () => {
    const params: ConstructorParam[] = [
      { name: "title", type: "String", isRequired: true, isNamed: true },
    ];
    const dart = generateTestDart({
      screen: { ...BASE_SCREEN, id: "DetailScreen" },
      appPackageName: "flutter_basic_fixture",
      params,
      device: "iphone-15",
      goldenFileName: "DetailScreen.png",
      mockSeed: 42,
    });
    expect(dart).toContain("title:");
    // mock 문자열이 주입되어야 함
    expect(dart).toMatch(/title:\s*'[^']+'/);
  });

  it("required int 파라미터가 있으면 mock 정수를 주입해야 한다", () => {
    const params: ConstructorParam[] = [
      { name: "count", type: "int", isRequired: true, isNamed: true },
    ];
    const dart = generateTestDart({
      screen: { ...BASE_SCREEN, id: "CountScreen" },
      appPackageName: "flutter_basic_fixture",
      params,
      device: "iphone-15",
      goldenFileName: "CountScreen.png",
      mockSeed: 42,
    });
    expect(dart).toContain("count:");
    expect(dart).toMatch(/count:\s*\d+/);
  });

  it("required double 파라미터가 있으면 mock 실수를 주입해야 한다", () => {
    const params: ConstructorParam[] = [
      { name: "price", type: "double", isRequired: true, isNamed: true },
    ];
    const dart = generateTestDart({
      screen: { ...BASE_SCREEN, id: "PriceScreen" },
      appPackageName: "flutter_basic_fixture",
      params,
      device: "iphone-15",
      goldenFileName: "PriceScreen.png",
      mockSeed: 42,
    });
    expect(dart).toContain("price:");
    expect(dart).toMatch(/price:\s*\d+\.\d+/);
  });

  it("required bool 파라미터가 있으면 false를 주입해야 한다", () => {
    const params: ConstructorParam[] = [
      { name: "isEnabled", type: "bool", isRequired: true, isNamed: true },
    ];
    const dart = generateTestDart({
      screen: { ...BASE_SCREEN, id: "ToggleScreen" },
      appPackageName: "flutter_basic_fixture",
      params,
      device: "iphone-15",
      goldenFileName: "ToggleScreen.png",
      mockSeed: 42,
    });
    expect(dart).toContain("isEnabled:");
    expect(dart).toMatch(/isEnabled:\s*(true|false)/);
  });

  it("matchesGoldenFile expectation이 있어야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "iphone-15",
      goldenFileName: "HomeScreen.png",
    });
    expect(dart).toContain("matchesGoldenFile");
    expect(dart).toContain("expectLater");
  });

  it("pumpAndSettle을 호출해야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "iphone-15",
      goldenFileName: "HomeScreen.png",
    });
    expect(dart).toContain("pumpAndSettle");
  });

  it("Roboto 폰트를 FontLoader로 로드해야 한다", () => {
    const dart = generateTestDart({
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params: NO_PARAMS,
      device: "iphone-15",
      goldenFileName: "HomeScreen.png",
    });
    expect(dart).toContain("FontLoader");
    expect(dart).toContain("Roboto");
  });

  it("mockSeed 42는 결정론적 결과를 내야 한다", () => {
    const params: ConstructorParam[] = [
      { name: "name", type: "String", isRequired: true, isNamed: true },
    ];
    const opts = {
      screen: BASE_SCREEN,
      appPackageName: "flutter_basic_fixture",
      params,
      device: "iphone-15" as const,
      goldenFileName: "HomeScreen.png",
      mockSeed: 42,
    };
    const dart1 = generateTestDart(opts);
    const dart2 = generateTestDart(opts);
    expect(dart1).toBe(dart2);
  });
});
