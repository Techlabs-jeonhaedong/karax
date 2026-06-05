import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { discoverFlutterNavGraph, readFlutterAppName } from "../discover/navGraph.js";
import { buildSymbolTable } from "../parse/scanner.js";
import { readPackageName } from "../parse/pubspec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures", "flutter-basic");

describe("discoverFlutterNavGraph (flutter-basic 픽스처)", () => {
  it("HomeScreen이 진입점으로 감지된다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    expect(graph.entryScreenId).toBe("HomeScreen");
  });

  it("HomeScreen → DetailScreen push 엣지가 존재한다 (Navigator.push)", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const pushEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen" && e.action === "push"
    );
    expect(pushEdge).toBeDefined();
    // 버튼 라벨
    expect(pushEdge?.trigger.label).toBe("View Product Details");
  });

  it("HomeScreen → ListScreen pushNamed 엣지가 존재한다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge).toBeDefined();
    expect(listEdge?.trigger.label).toBe("Browse List");
  });

  it("HomeScreen → SettingsScreen pushNamed 엣지가 존재한다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const settingsEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "SettingsScreen"
    );
    expect(settingsEdge).toBeDefined();
  });

  it("edges에 from이 없는 화면(OrphanScreen)의 엣지는 없다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const orphanEdge = graph.edges.find((e) => e.from === "OrphanScreen");
    expect(orphanEdge).toBeUndefined();
  });

  it("diagnostics 배열이 반환된다 (에러 없음)", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    expect(Array.isArray(graph.diagnostics)).toBe(true);
  });
});

describe("readFlutterAppName (flutter-basic 픽스처)", () => {
  it("pubspec.yaml에서 앱 이름을 반환한다", async () => {
    const appName = await readFlutterAppName(FIXTURE_PATH);
    // flutter-basic의 pubspec.yaml name 필드
    expect(typeof appName).toBe("string");
    expect(appName!.length).toBeGreaterThan(0);
  });
});
