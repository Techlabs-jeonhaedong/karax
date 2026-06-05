import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { discoverRNNavGraph, readRNAppName } from "../discover/navGraph.js";
import { buildSymbolTable } from "../parse/scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures", "react-native-basic");

describe("discoverRNNavGraph (react-native-basic 픽스처)", () => {
  it("HomeScreen이 진입점으로 감지된다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    expect(graph.entryScreenId).toBe("HomeScreen");
  });

  it("HomeScreen → ListScreen navigate 엣지가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge).toBeDefined();
    expect(listEdge?.action).toBe("navigate");
  });

  it("HomeScreen → DetailScreen navigate 엣지가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const detailEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(detailEdge).toBeDefined();
  });

  it("HomeScreen → SettingsScreen navigate 엣지가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const settingsEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "SettingsScreen"
    );
    expect(settingsEdge).toBeDefined();
  });

  it("DetailScreen에 goBack pop 엣지가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const backEdge = graph.edges.find(
      (e) => e.from === "DetailScreen" && e.action === "pop"
    );
    expect(backEdge).toBeDefined();
  });

  it("diagnostics 배열이 반환된다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    expect(Array.isArray(graph.diagnostics)).toBe(true);
  });
});

describe("readRNAppName (react-native-basic 픽스처)", () => {
  it("app.json 또는 package.json에서 앱 이름을 반환한다", async () => {
    const appName = await readRNAppName(FIXTURE_PATH);
    expect(typeof appName).toBe("string");
    expect(appName!.length).toBeGreaterThan(0);
  });
});
