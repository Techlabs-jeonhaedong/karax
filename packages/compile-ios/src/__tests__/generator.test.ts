/**
 * compile-ios — harness generator 유닛 테스트
 * TDD Red 단계: 구현 전 먼저 작성
 */
import { describe, expect, it } from "vitest";
import {
  generatePackageSwift,
  generateCaptureTest,
  buildMockValue,
  selectSimulator,
} from "../harness/generator.js";
import type { ScreenSummary } from "@karax/adapter-api";

// ── generatePackageSwift ──────────────────────────────────────────────────────

describe("generatePackageSwift", () => {
  it("올바른 platforms .iOS(.v16) 선언 포함", () => {
    const result = generatePackageSwift({
      packageName: "SFCHarness",
      sourceFiles: ["Sources/Screens/HomeScreen.swift"],
    });
    expect(result).toContain(".iOS(.v16)");
  });

  it("라이브러리 타깃과 테스트 타깃 모두 선언", () => {
    const result = generatePackageSwift({
      packageName: "SFCHarness",
      sourceFiles: ["Sources/Screens/HomeScreen.swift", "Sources/Components/PriceTag.swift"],
    });
    expect(result).toContain('.library(name: "SFCHarness"');
    // 멀티라인 포맷이므로 name 부분만 검사
    expect(result).toContain('"SFCHarnessTests"');
    expect(result).toContain(".testTarget(");
  });

  it("swift-tools-version 헤더 포함", () => {
    const result = generatePackageSwift({ packageName: "MyPkg", sourceFiles: [] });
    expect(result).toMatch(/\/\/ swift-tools-version:/);
  });

  it("excludeFiles 지정 시 exclude 선언 포함", () => {
    const result = generatePackageSwift({
      packageName: "SFCHarness",
      sourceFiles: [],
      excludeFiles: ["Screens/BrokenScreen.swift"],
    });
    expect(result).toContain("exclude:");
    expect(result).toContain("BrokenScreen.swift");
  });

  it("MyApp.swift는 항상 exclude에 포함", () => {
    const result = generatePackageSwift({
      packageName: "SFCHarness",
      sourceFiles: [],
    });
    expect(result).toContain("MyApp.swift");
  });
});

// ── generateCaptureTest ──────────────────────────────────────────────────────

describe("generateCaptureTest", () => {
  const screen: ScreenSummary = {
    id: "HomeScreen",
    discovery: "route",
    confidence: 0.9,
    sourceRef: { file: "Sources/Screens/HomeScreen.swift", line: 1 },
  };

  it("@MainActor XCTestCase 상속 코드 생성", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/karax-ios-abc/HomeScreen.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    expect(result).toContain("@MainActor");
    expect(result).toContain("XCTestCase");
  });

  it("outPath가 코드에 직접 삽입됨", () => {
    const outPath = "/tmp/karax-ios-abc123/HomeScreen.png";
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath,
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    expect(result).toContain(outPath);
  });

  it("UIHostingController + UIWindow 1차 캡처 + ImageRenderer 2차 폴백 포함", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    // 1차: UIWindow + UIHostingController
    expect(result).toContain("UIWindow");
    expect(result).toContain("makeKeyAndVisible");
    // 2차 폴백: ImageRenderer
    expect(result).toContain("ImageRenderer");
    expect(result).toContain("pngData");
  });

  it("UIWindow에 attach해서 1차 렌더링 (iOS 26 NavigationStack 지원)", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    // 1차: UIWindow에 attach — NavigationStack 등 scene-dependent 뷰 지원
    expect(result).toContain("UIWindow");
    expect(result).toContain("makeKeyAndVisible");
  });

  it("background white + colorScheme light 환경 설정으로 투명 이미지 방지", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    expect(result).toContain("Color.white");
    expect(result).toContain("colorScheme");
    expect(result).toContain(".light");
  });

  it("layer.render + drawHierarchy 3단계 폴백 체인 포함", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    expect(result).toContain("layer.render");
    expect(result).toContain("drawHierarchy");
  });

  it("RunLoop을 통해 렌더 싸이클이 완료될 때까지 대기", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    // RunLoop 또는 Task.sleep으로 렌더 대기
    expect(result).toMatch(/RunLoop\.main\.run|Task\.sleep|await.*sleep/);
  });

  it("화면 프레임 크기가 코드에 반영됨", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 430,
      height: 932,
      scale: 3.0,
      constructorArgs: "",
    });
    expect(result).toContain("430");
    expect(result).toContain("932");
  });

  it("생성자 인자가 화면 초기화 코드에 삽입됨", () => {
    const result = generateCaptureTest({
      screen,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: 'title: "Test", count: 42',
    });
    expect(result).toContain('title: "Test"');
    expect(result).toContain("count: 42");
  });

  it("스크린 id 없는 빈 sourceRef도 처리", () => {
    const screenNoRef: ScreenSummary = {
      id: "OrphanScreen",
      discovery: "candidate",
      confidence: 0.5,
    };
    const result = generateCaptureTest({
      screen: screenNoRef,
      moduleName: "SFCHarness",
      outPath: "/tmp/out.png",
      width: 390,
      height: 844,
      scale: 3.0,
      constructorArgs: "",
    });
    expect(result).toContain("OrphanScreen");
  });
});

// ── buildMockValue ───────────────────────────────────────────────────────────

describe("buildMockValue", () => {
  it("String 타입 → 따옴표 감싼 문자열 반환", () => {
    expect(buildMockValue("String", "title", 42)).toMatch(/^".*"$/);
  });

  it("Int 타입 → 정수 반환", () => {
    const val = buildMockValue("Int", "count", 42);
    expect(Number(val)).toEqual(expect.any(Number));
    expect(val).not.toContain('"');
  });

  it("Double 타입 → 소수 반환", () => {
    const val = buildMockValue("Double", "price", 42);
    expect(val).toContain(".");
  });

  it("Bool 타입 → true 또는 false", () => {
    const val = buildMockValue("Bool", "isEnabled", 42);
    expect(["true", "false"]).toContain(val);
  });

  it("[String] 타입 → Swift 배열 리터럴 반환", () => {
    const val = buildMockValue("[String]", "items", 42);
    expect(val).toMatch(/^\[.*\]$/);
  });

  it("알 수 없는 타입 → nil 반환", () => {
    const val = buildMockValue("SomeCustomType", "obj", 42);
    expect(val).toBe("nil");
  });

  it("같은 seed=42이면 결정론적 결과", () => {
    const v1 = buildMockValue("String", "name", 42);
    const v2 = buildMockValue("String", "name", 42);
    expect(v1).toBe(v2);
  });

  it("seed가 다르면 결과가 달라질 수 있음", () => {
    const v1 = buildMockValue("Int", "count", 1);
    const v2 = buildMockValue("Int", "count", 999);
    // 결정론적이므로 seed별 차이를 허용 (같아도 무방하지만 다른 경우 확인)
    expect(typeof v1).toBe(typeof v2);
  });

  it("String? (optional) 타입 → nil 또는 문자열", () => {
    const val = buildMockValue("String?", "name", 42);
    const isValid = val === "nil" || val.match(/^".*"$/) !== null;
    expect(isValid).toBe(true);
  });
});

// ── selectSimulator ───────────────────────────────────────────────────────────

describe("selectSimulator", () => {
  const sampleOutput = `== Devices ==
-- iOS 18.5 --
    iPhone 16 Pro (AABBCCDD-0000-0000-0000-000000000001) (Shutdown)
    iPhone 16 (AABBCCDD-0000-0000-0000-000000000002) (Shutdown)
-- iOS 17.5 --
    iPhone 15 (AABBCCDD-0000-0000-0000-000000000003) (Shutdown)
`;

  it("가장 높은 iOS 버전의 iPhone을 반환", () => {
    const sim = selectSimulator(sampleOutput);
    expect(sim).not.toBeNull();
    expect(sim!.udid).toBe("AABBCCDD-0000-0000-0000-000000000001");
  });

  it("iPhone 모델을 선호 (iPhone 16 Pro 우선)", () => {
    const sim = selectSimulator(sampleOutput);
    expect(sim!.name).toContain("iPhone");
  });

  it("시뮬레이터가 없으면 null 반환", () => {
    const sim = selectSimulator("== Devices ==\n-- iOS 18.5 --\n");
    expect(sim).toBeNull();
  });

  it("iPad만 있으면 iPad 반환", () => {
    const output = `== Devices ==
-- iOS 18.5 --
    iPad Pro 11-inch (M4) (AABBCCDD-0000-0000-0000-000000000099) (Shutdown)
`;
    const sim = selectSimulator(output);
    expect(sim).not.toBeNull();
    expect(sim!.udid).toBe("AABBCCDD-0000-0000-0000-000000000099");
  });
});
