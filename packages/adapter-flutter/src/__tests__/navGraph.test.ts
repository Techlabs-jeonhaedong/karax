import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { discoverFlutterNavGraph, readFlutterAppName } from "../discover/navGraph.js";
import { buildSymbolTable } from "../parse/scanner.js";
import { readPackageName } from "../parse/pubspec.js";
import { buildScreenIR as buildFlutterScreenIR } from "../ir/builder.js";

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

describe("discoverFlutterNavGraph — trigger.elementRef", () => {
  it("HomeScreen → DetailScreen 엣지의 trigger.elementRef가 존재한다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const pushEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen" && e.action === "push"
    );
    expect(pushEdge).toBeDefined();
    expect(pushEdge!.trigger.elementRef).toBeDefined();
  });

  it("HomeScreen → DetailScreen 엣지의 elementRef.file이 home_screen.dart 상대경로다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const pushEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(pushEdge!.trigger.elementRef!.file).toBe("lib/screens/home_screen.dart");
  });

  it("HomeScreen → DetailScreen 엣지의 elementRef.line이 ElevatedButton onPressed 라인(112)이다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const pushEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(pushEdge!.trigger.elementRef!.line).toBe(112);
  });

  it("HomeScreen → ListScreen 엣지의 elementRef가 존재하고 올바른 라인이다", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge!.trigger.elementRef).toBeDefined();
    expect(listEdge!.trigger.elementRef!.file).toBe("lib/screens/home_screen.dart");
    expect(listEdge!.trigger.elementRef!.line).toBe(140);
  });

  it("elementRef.file 형식이 buildScreenIR IR 노드 sourceRef.file 형식과 동일하다 (매칭 키 정합성)", async () => {
    const pkgName = await readPackageName(FIXTURE_PATH);
    const symbolTable = await buildSymbolTable(FIXTURE_PATH, pkgName);
    const graph = await discoverFlutterNavGraph(FIXTURE_PATH, symbolTable);

    // trigger가 있는 edge의 elementRef.file을 수집
    const elementRefFiles = graph.edges
      .map((e) => e.trigger.elementRef?.file)
      .filter((f): f is string => f !== undefined);
    expect(elementRefFiles.length).toBeGreaterThan(0);

    // IR 노드 sourceRef.file을 buildScreenIR에서 수집
    const homeScreenId = graph.edges.find((e) => e.from === "HomeScreen")?.from;
    if (!homeScreenId) return;

    const ir = await buildFlutterScreenIR({ projectPath: FIXTURE_PATH, mockSeed: 42 }, "HomeScreen");

    // IR의 sourceRef.file 중 dart 파일이 존재하는지 확인하고 형식 비교
    function collectFiles(node: { sourceRef?: { file: string }; children?: unknown[] }): string[] {
      const files: string[] = [];
      if (node.sourceRef?.file) files.push(node.sourceRef.file);
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
    const irDartFiles = irFiles.filter((f) => f.endsWith(".dart"));
    if (irDartFiles.length === 0) return; // IR에 dart sourceRef 없으면 스킵

    // 형식 비교: 둘 다 상대경로(lib/로 시작하는 경로)여야 함
    for (const refFile of elementRefFiles) {
      expect(refFile.startsWith("lib/")).toBe(true);
    }
    for (const irFile of irDartFiles) {
      expect(irFile.startsWith("lib/")).toBe(true);
    }
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
