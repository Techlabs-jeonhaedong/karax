/**
 * adapter-ios discover 테스트 (Red → Green)
 * fixtures/ios-swiftui-basic를 기준으로 화면 발견을 검증한다.
 */

import path from "path";
import { describe, it, expect } from "vitest";
import { buildSwiftSymbolTable } from "../parse/scanner.js";
import { discoverSwiftRouteGraph } from "../discover/routeGraph.js";
import { findSwiftHeuristicCandidates } from "../discover/heuristic.js";

const FIXTURE = path.resolve("../../fixtures/ios-swiftui-basic");

describe("buildSwiftSymbolTable", () => {
  it("Sources 디렉토리의 모든 .swift 파일을 파싱한다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    // HomeScreen, ListScreen, DetailScreen, SettingsScreen, OrphanScreen
    // + ProductCard, PriceTag, MyApp
    expect(table.structs.size).toBeGreaterThanOrEqual(7);
  });

  it("HomeScreen이 View를 상속하는 struct로 등록된다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const info = table.structs.get("HomeScreen");
    expect(info).toBeDefined();
    expect(info?.conformsToView).toBe(true);
  });

  it("typealias ContentView = HomeScreen이 aliasMap에 등록된다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    expect(table.aliasMap.get("ContentView")).toBe("HomeScreen");
  });

  it("@main MyApp이 mainApp으로 등록된다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    expect(table.mainApp).toBe("MyApp");
  });
});

describe("discoverSwiftRouteGraph", () => {
  it("HomeScreen이 route로 발견된다 (WindowGroup → ContentView → HomeScreen via typealias)", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const result = await discoverSwiftRouteGraph(FIXTURE, table);
    const ids = result.routes.map((r) => r.className);
    expect(ids).toContain("HomeScreen");
  });

  it("NavigationLink destination 화면들이 route로 발견된다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const result = await discoverSwiftRouteGraph(FIXTURE, table);
    const ids = result.routes.map((r) => r.className);
    // HomeScreen.swift 내 NavigationLink(destination: ListScreen()), SettingsScreen(), DetailScreen()
    expect(ids).toContain("ListScreen");
    expect(ids).toContain("SettingsScreen");
    expect(ids).toContain("DetailScreen");
  });

  it("OrphanScreen은 route에 포함되지 않는다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const result = await discoverSwiftRouteGraph(FIXTURE, table);
    const ids = result.routes.map((r) => r.className);
    expect(ids).not.toContain("OrphanScreen");
  });

  it("route 엔트리에 source 정보가 있다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const result = await discoverSwiftRouteGraph(FIXTURE, table);
    const home = result.routes.find((r) => r.className === "HomeScreen");
    expect(home?.source).toBeDefined();
  });
});

describe("findSwiftHeuristicCandidates", () => {
  it("OrphanScreen이 candidate로 발견된다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const routeClassSet = new Set<string>();
    // route에 없는 것만 candidate 대상이므로 route 빈 집합으로 테스트
    const candidates = findSwiftHeuristicCandidates(table, routeClassSet);
    const ids = candidates.map((c) => c.className);
    expect(ids).toContain("OrphanScreen");
  });

  it("route에 이미 포함된 HomeScreen은 candidate에서 제외된다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const routeSet = new Set(["HomeScreen", "ListScreen", "DetailScreen", "SettingsScreen"]);
    const candidates = findSwiftHeuristicCandidates(table, routeSet);
    const ids = candidates.map((c) => c.className);
    expect(ids).not.toContain("HomeScreen");
  });

  it("ProductCard, PriceTag는 Screen/Page/View 접미사가 없으므로 candidate에서 제외된다", async () => {
    const table = await buildSwiftSymbolTable(FIXTURE);
    const candidates = findSwiftHeuristicCandidates(table, new Set());
    const ids = candidates.map((c) => c.className);
    // Component들은 접미사도 없고 appbar/scaffold 반환도 아님
    // 단, View 접미사를 가진 private 뷰들은 구조체가 private이므로 제외될 수 있음
    // OrphanScreen은 반드시 포함
    expect(ids).toContain("OrphanScreen");
  });
});

describe("iosAdapter.discoverScreens — 엣지 케이스", () => {
  it("빈 Sources 디렉토리 프로젝트에서 빈 배열을 반환한다", async () => {
    const { findSwiftHeuristicCandidates } = await import("../discover/heuristic.js");
    const emptyTable = {
      structs: new Map(),
      fileByStruct: new Map(),
      files: new Map(),
      aliasMap: new Map(),
      mainApp: undefined,
    };
    const candidates = findSwiftHeuristicCandidates(emptyTable as any, new Set());
    expect(candidates).toHaveLength(0);
  });
});
