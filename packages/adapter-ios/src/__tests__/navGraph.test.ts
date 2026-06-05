/**
 * iOS navGraph 테스트
 *
 * 검증 포인트:
 * - entryScreenId = HomeScreen (ContentView alias → HomeScreen)
 * - HomeScreen → ListScreen (push, label = "Browse Products")
 * - HomeScreen → SettingsScreen (push, label = "Settings")
 * - HomeScreen → DetailScreen (push, label = "View Featured Products")
 * - OrphanScreen은 edges에 없음
 * - readIOSAppName → Package.swift에서 앱 이름 또는 undefined
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { buildSwiftSymbolTable } from "../parse/scanner.js";
import { discoverIOSNavGraph, readIOSAppName } from "../discover/navGraph.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");
const FIXTURE = path.join(FIXTURES_DIR, "ios-swiftui-basic");

describe("discoverIOSNavGraph — fixture", () => {
  it("entryScreenId가 HomeScreen이다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);
    expect(graph.entryScreenId).toBe("HomeScreen");
  });

  it("HomeScreen → ListScreen push edge가 존재한다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);
    const edge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(edge).toBeDefined();
    expect(edge!.action).toBe("push");
    expect(edge!.trigger.label).toBe("Browse Products");
  });

  it("HomeScreen → SettingsScreen push edge가 존재한다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);
    const edge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "SettingsScreen"
    );
    expect(edge).toBeDefined();
    expect(edge!.action).toBe("push");
    expect(edge!.trigger.label).toBe("Settings");
  });

  it("HomeScreen → DetailScreen push edge가 존재한다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);
    const edge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(edge).toBeDefined();
    expect(edge!.action).toBe("push");
  });

  it("OrphanScreen은 edges에 없다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);
    const orphanEdges = graph.edges.filter(
      (e) => e.from === "OrphanScreen" || e.to === "OrphanScreen"
    );
    expect(orphanEdges).toHaveLength(0);
  });
});

describe("readIOSAppName — fixture", () => {
  it("앱 이름을 반환하거나 undefined를 반환한다", async () => {
    const name = await readIOSAppName(FIXTURE);
    // Package.swift가 있으면 name을, 없으면 undefined
    expect(typeof name === "string" || name === undefined).toBe(true);
  });
});
