import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { buildSymbolTable } from "../parse/scanner.js";
import { discoverRouteGraph } from "../discover/routeGraph.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures/react-native-basic");
const TAB_FIXTURE = path.resolve(__dirname, "fixtures/tab-navigator");
const SINGLE_FIXTURE = path.resolve(__dirname, "fixtures/single-app");
const SINGLE_WITH_ENTRY_FIXTURE = path.resolve(__dirname, "fixtures/single-screen-with-entry");

describe("routeGraph — react-native-basic fixture", () => {
  it("4개의 라우트 화면을 발견한다 (Home/Detail/List/Settings)", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const { routes } = await discoverRouteGraph(FIXTURE_PATH, table);
    const componentNames = routes.map(r => r.componentName);

    expect(componentNames).toContain("HomeScreen");
    expect(componentNames).toContain("DetailScreen");
    expect(componentNames).toContain("ListScreen");
    expect(componentNames).toContain("SettingsScreen");
  });

  it("OrphanScreen은 라우트에 포함되지 않는다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const { routes } = await discoverRouteGraph(FIXTURE_PATH, table);
    const componentNames = routes.map(r => r.componentName);
    expect(componentNames).not.toContain("OrphanScreen");
  });

  it("route source가 stack-screen이다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const { routes } = await discoverRouteGraph(FIXTURE_PATH, table);
    const homeRoute = routes.find(r => r.componentName === "HomeScreen");
    expect(homeRoute?.source).toBe("stack-screen");
  });

  it("라우트 이름이 올바르게 파싱된다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const { routes } = await discoverRouteGraph(FIXTURE_PATH, table);
    const homeRoute = routes.find(r => r.componentName === "HomeScreen");
    expect(homeRoute?.name).toBe("Home");
  });
});

describe("routeGraph — tab navigator fixture", () => {
  it("Tab.Screen 컴포넌트를 발견한다", async () => {
    const table = await buildSymbolTable(TAB_FIXTURE);
    const { routes } = await discoverRouteGraph(TAB_FIXTURE, table);
    const componentNames = routes.map(r => r.componentName);
    expect(componentNames).toContain("FeedScreen");
    expect(componentNames).toContain("ProfileScreen");
  });

  it("tab-screen source가 올바르게 기록된다", async () => {
    const table = await buildSymbolTable(TAB_FIXTURE);
    const { routes } = await discoverRouteGraph(TAB_FIXTURE, table);
    const feedRoute = routes.find(r => r.componentName === "FeedScreen");
    expect(feedRoute?.source).toBe("tab-screen");
  });
});

describe("routeGraph — single app (index.js 없음, 진입점 탐색 불가)", () => {
  it("라우트가 0개이고 NO_ENTRY_POINT 진단이 생성된다", async () => {
    const table = await buildSymbolTable(SINGLE_FIXTURE);
    const { routes, diagnostics } = await discoverRouteGraph(SINGLE_FIXTURE, table);
    expect(routes).toHaveLength(0);
    expect(diagnostics.some(d => d.code === "NO_ENTRY_POINT")).toBe(true);
    // NO_NAVIGATOR는 발생하지 않아야 함
    expect(diagnostics.some(d => d.code === "NO_NAVIGATOR")).toBe(false);
  });
});

describe("routeGraph — single screen with entry (index.js 있음, navigator 없음)", () => {
  it("라우트가 0개이고 NO_NAVIGATOR 진단이 생성된다", async () => {
    const table = await buildSymbolTable(SINGLE_WITH_ENTRY_FIXTURE);
    const { routes, diagnostics } = await discoverRouteGraph(SINGLE_WITH_ENTRY_FIXTURE, table);
    expect(routes).toHaveLength(0);
    expect(diagnostics.some(d => d.code === "NO_NAVIGATOR")).toBe(true);
    // NO_ENTRY_POINT는 발생하지 않아��� 함
    expect(diagnostics.some(d => d.code === "NO_ENTRY_POINT")).toBe(false);
  });
});
