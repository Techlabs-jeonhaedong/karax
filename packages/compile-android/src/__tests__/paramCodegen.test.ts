/**
 * Kotlin 생성자 파라미터 파싱 + Mock 값 생성 단위 테스트
 */

import { describe, it, expect } from "vitest";
import {
  parseKotlinConstructorParams,
  generateKotlinMockArg,
  type KotlinParam,
} from "../harness/paramCodegen.js";

// ─── Fixture 소스 ─────────────────────────────────────────────────────────────

const HOME_SCREEN_SOURCE = `
@Composable
fun HomeScreen(
    onExploreClick: () -> Unit,
    onListClick: () -> Unit,
    onSettingsClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold { }
}
`;

const DETAIL_SCREEN_SOURCE = `
@Composable
fun DetailScreen(
    itemId: String,
    itemName: String,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
}
`;

const NO_PARAMS_SOURCE = `
@Composable
fun SettingsScreen() {
    Box {}
}
`;

// ─── parseKotlinConstructorParams ─────────────────────────────────────────────

describe("parseKotlinConstructorParams", () => {
  it("함수명이 일치하면 파라미터 목록 반환", () => {
    const params = parseKotlinConstructorParams("HomeScreen", HOME_SCREEN_SOURCE);
    expect(params.length).toBeGreaterThan(0);
  });

  it("lambda 타입 파라미터 파싱 (onExploreClick: () -> Unit)", () => {
    const params = parseKotlinConstructorParams("HomeScreen", HOME_SCREEN_SOURCE);
    const lambda = params.find((p) => p.name === "onExploreClick");
    expect(lambda).toBeDefined();
    expect(lambda?.type).toContain("Unit");
  });

  it("modifier 기본값 있는 파라미터 → isRequired=false", () => {
    const params = parseKotlinConstructorParams("HomeScreen", HOME_SCREEN_SOURCE);
    const mod = params.find((p) => p.name === "modifier");
    expect(mod?.isRequired).toBe(false);
  });

  it("String 타입 파라미터 파싱", () => {
    const params = parseKotlinConstructorParams("DetailScreen", DETAIL_SCREEN_SOURCE);
    const itemId = params.find((p) => p.name === "itemId");
    expect(itemId).toBeDefined();
    expect(itemId?.type).toContain("String");
    expect(itemId?.isRequired).toBe(true);
  });

  it("파라미터 없는 Composable → 빈 배열 반환", () => {
    const params = parseKotlinConstructorParams("SettingsScreen", NO_PARAMS_SOURCE);
    expect(params).toEqual([]);
  });

  it("함수명 불일치 → 빈 배열 반환", () => {
    const params = parseKotlinConstructorParams("NonExistentScreen", HOME_SCREEN_SOURCE);
    expect(params).toEqual([]);
  });
});

// ─── generateKotlinMockArg ─────────────────────────────────────────────────────

describe("generateKotlinMockArg", () => {
  it("() -> Unit 람다 → {}  반환", () => {
    const param: KotlinParam = { name: "onClick", type: "() -> Unit", isRequired: true };
    const val = generateKotlinMockArg(param, 42);
    expect(val).toContain("{}");
  });

  it("String 타입 → 문자열 리터럴 반환", () => {
    const param: KotlinParam = { name: "title", type: "String", isRequired: true };
    const val = generateKotlinMockArg(param, 42);
    expect(val).toMatch(/^".*"$/);
  });

  it("Int 타입 → 숫자 반환", () => {
    const param: KotlinParam = { name: "count", type: "Int", isRequired: true };
    const val = generateKotlinMockArg(param, 42);
    expect(parseInt(val)).not.toBeNaN();
  });

  it("Boolean 타입 → true 또는 false 반환", () => {
    const param: KotlinParam = { name: "isVisible", type: "Boolean", isRequired: true };
    const val = generateKotlinMockArg(param, 42);
    expect(["true", "false"]).toContain(val);
  });

  it("List<String> → listOf(...) 반환", () => {
    const param: KotlinParam = { name: "items", type: "List<String>", isRequired: true };
    const val = generateKotlinMockArg(param, 42);
    expect(val).toContain("listOf");
  });

  it("seed 42로 String 결정론적 생성 (같은 시드 → 같은 값)", () => {
    const param: KotlinParam = { name: "title", type: "String", isRequired: true };
    const v1 = generateKotlinMockArg(param, 42);
    const v2 = generateKotlinMockArg(param, 42);
    expect(v1).toBe(v2);
  });

  it("알 수 없는 타입 → TODO() 폴백", () => {
    const param: KotlinParam = { name: "thing", type: "MyComplexType", isRequired: true };
    const val = generateKotlinMockArg(param, 42);
    // TODO() 또는 빈 {} — 어느 쪽이든 compilable해야 함
    expect(typeof val).toBe("string");
    expect(val.length).toBeGreaterThan(0);
  });
});
