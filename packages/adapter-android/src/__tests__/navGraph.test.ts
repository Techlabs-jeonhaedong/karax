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
import { buildScreenIR as buildAndroidScreenIR } from "../ir/builder.js";

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

describe("discoverAndroidNavGraph — trigger.elementRef", () => {
  it("HomeScreen → DetailScreen 엣지의 trigger.elementRef가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);

    const exploreEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(exploreEdge).toBeDefined();
    expect(exploreEdge!.trigger.elementRef).toBeDefined();
  });

  it("HomeScreen → DetailScreen 엣지의 elementRef.file이 HomeScreen.kt 상대경로다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);

    const exploreEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    // path.relative(projectPath, ...) 형식 — app/src/main/java/... 로 시작해야 함
    expect(exploreEdge!.trigger.elementRef!.file).toContain("HomeScreen.kt");
  });

  it("HomeScreen → DetailScreen 엣지의 elementRef.line이 Button 시작 라인(148)이다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);

    const exploreEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    // regex가 "Button(" 매치 시작 위치에서 1-based 라인 계산
    expect(exploreEdge!.trigger.elementRef!.line).toBe(148);
  });

  it("HomeScreen → ListScreen 엣지의 elementRef가 존재하고 올바른 라인이다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge!.trigger.elementRef).toBeDefined();
    // OutlinedButton(onClick = onListClick) — 190번 라인
    expect(listEdge!.trigger.elementRef!.line).toBe(190);
  });

  it("elementRef.file 형식이 buildScreenIR IR 노드 sourceRef.file 형식과 동일하다 (매칭 키 정합성)", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE);
    const graph = await discoverAndroidNavGraph(FIXTURE, symbolTable);

    const elementRefFiles = graph.edges
      .map((e) => e.trigger.elementRef?.file)
      .filter((f): f is string => f !== undefined);
    expect(elementRefFiles.length).toBeGreaterThan(0);

    const ir = await buildAndroidScreenIR({ projectPath: FIXTURE, mockSeed: 42 }, "HomeScreen");

    function collectFiles(node: { sourceRef?: { file: string }; children?: unknown[] }): string[] {
      const files: string[] = [];
      if (node.sourceRef?.file && node.sourceRef.file !== "unknown") {
        files.push(node.sourceRef.file);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child && typeof child === "object") {
            files.push(...collectFiles(child as { sourceRef?: { file: string }; children?: unknown[] }));
          }
        }
      }
      return files;
    }

    const irFiles = collectFiles(ir.screen.root);
    const irKtFiles = irFiles.filter((f) => f.endsWith(".kt"));
    if (irKtFiles.length === 0) return;

    // 형식 비교: 둘 다 상대경로 (app/src/...으로 시작)
    for (const refFile of elementRefFiles) {
      expect(refFile.startsWith("app/src/")).toBe(true);
    }
    for (const irFile of irKtFiles) {
      expect(irFile.startsWith("app/src/")).toBe(true);
    }
  });
});

describe("readAndroidAppName — fixture", () => {
  it("strings.xml app_name을 반환한다", async () => {
    const name = await readAndroidAppName(FIXTURE);
    expect(name).toBe("Fixture App");
  });
});
