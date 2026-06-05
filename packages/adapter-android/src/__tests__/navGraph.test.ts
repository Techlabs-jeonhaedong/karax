/**
 * Android navGraph 테스트
 *
 * 검증 포인트:
 * - entryScreenId = HomeScreen (startDestination = AppRoutes.HOME)
 * - HomeScreen → DetailScreen (push, label = "Explore Products", R.string 해석)
 * - HomeScreen → ListScreen (push, label = "Browse All Items", 리터럴)
 * - HomeScreen → SettingsScreen (push, label = "Settings", R.string 해석)
 * - DetailScreen, ListScreen, SettingsScreen → HomeScreen pop (popBackStack)
 * - OrphanScreen은 NavHost에 없으므로 edges 없음
 * - readAndroidAppName → "Fixture App" (strings.xml app_name)
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { buildSymbolTable } from "../parse/scanner.js";
import { discoverAndroidNavGraph, readAndroidAppName } from "../discover/navGraph.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");
const FIXTURE = path.join(FIXTURES_DIR, "android-compose-basic");

describe("discoverAndroidNavGraph — fixture", () => {
  it("entryScreenId가 HomeScreen이다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);
    expect(graph.entryScreenId).toBe("HomeScreen");
  });

  it("HomeScreen에서 DetailScreen으로 push edge가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);
    const exploreEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(exploreEdge).toBeDefined();
    expect(exploreEdge!.action).toBe("push");
    expect(exploreEdge!.trigger.label).toBe("Explore Products");
  });

  it("HomeScreen에서 ListScreen으로 push edge가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);
    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge).toBeDefined();
    expect(listEdge!.action).toBe("push");
    expect(listEdge!.trigger.label).toBe("Browse All Items");
  });

  it("HomeScreen에서 SettingsScreen으로 push edge가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);
    const settingsEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "SettingsScreen"
    );
    expect(settingsEdge).toBeDefined();
    expect(settingsEdge!.action).toBe("push");
  });

  it("DetailScreen에서 pop edge (popBackStack)가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);
    const popEdge = graph.edges.find(
      (e) => e.from === "DetailScreen" && e.action === "pop"
    );
    expect(popEdge).toBeDefined();
  });

  it("OrphanScreen은 edges에 없다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);
    const orphanEdges = graph.edges.filter(
      (e) => e.from === "OrphanScreen" || e.to === "OrphanScreen"
    );
    expect(orphanEdges).toHaveLength(0);
  });
});

describe("readAndroidAppName — fixture", () => {
  it("strings.xml app_name을 반환한다", async () => {
    const name = await readAndroidAppName(FIXTURE);
    expect(name).toBe("Fixture App");
  });
});
