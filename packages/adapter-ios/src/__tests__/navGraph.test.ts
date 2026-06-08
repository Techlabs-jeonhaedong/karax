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
import { describe, expect, it, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { buildSwiftSymbolTable } from "../parse/scanner.js";
import { discoverIOSNavGraph, readIOSAppName } from "../discover/navGraph.js";
import { buildSwiftScreenIR } from "../ir/builder.js";

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

describe("discoverIOSNavGraph — trigger.elementRef", () => {
  it("HomeScreen → ListScreen 엣지의 trigger.elementRef가 존재한다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge).toBeDefined();
    expect(listEdge!.trigger.elementRef).toBeDefined();
  });

  it("HomeScreen → ListScreen 엣지의 elementRef.file이 HomeScreen.swift 상대경로다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge!.trigger.elementRef!.file).toContain("HomeScreen.swift");
  });

  it("HomeScreen → ListScreen 엣지의 elementRef.line이 NavigationLink 라인(67)이다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge!.trigger.elementRef!.line).toBe(67);
  });

  it("HomeScreen → SettingsScreen 엣지의 elementRef.line이 NavigationLink 라인(84)이다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);

    const settingsEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "SettingsScreen"
    );
    expect(settingsEdge!.trigger.elementRef).toBeDefined();
    expect(settingsEdge!.trigger.elementRef!.line).toBe(84);
  });

  it("HomeScreen → DetailScreen 엣지의 elementRef.line이 NavigationLink 라인(104)이다", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);

    const detailEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(detailEdge!.trigger.elementRef).toBeDefined();
    expect(detailEdge!.trigger.elementRef!.line).toBe(104);
  });

  it("elementRef.file 형식이 buildSwiftScreenIR IR 노드 sourceRef.file 형식과 동일하다 (매칭 키 정합성)", async () => {
    const symbolTable = await buildSwiftSymbolTable(FIXTURE);
    const graph = await discoverIOSNavGraph(FIXTURE, symbolTable);

    const elementRefFiles = graph.edges
      .map((e) => e.trigger.elementRef?.file)
      .filter((f): f is string => f !== undefined);
    expect(elementRefFiles.length).toBeGreaterThan(0);

    const ir = await buildSwiftScreenIR({ projectPath: FIXTURE, mockSeed: 42 }, "HomeScreen");

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
    const irSwiftFiles = irFiles.filter((f) => f.endsWith(".swift"));
    if (irSwiftFiles.length === 0) return;

    // 형식 비교: 둘 다 상대경로 (Sources/로 시작)
    for (const refFile of elementRefFiles) {
      expect(refFile.startsWith("Sources/")).toBe(true);
    }
    for (const irFile of irSwiftFiles) {
      expect(irFile.startsWith("Sources/")).toBe(true);
    }
  });
});

describe("readIOSAppName — fixture", () => {
  it("앱 이름을 반환하거나 undefined를 반환한다", async () => {
    const name = await readIOSAppName(FIXTURE);
    // Package.swift가 있으면 name을, 없으면 undefined
    expect(typeof name === "string" || name === undefined).toBe(true);
  });
});

// ── DYNAMIC_NAV vs UNRESOLVED_NAV 분리 — 합성 임시 픽스처 ────────────────────

describe("iOS navGraph — DYNAMIC_NAV vs UNRESOLVED_NAV 진단 코드 분리", () => {
  const tmpDirs: string[] = [];

  function mkProject(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-ios-nav-"));
    tmpDirs.push(dir);
    for (const [relPath, content] of Object.entries(files)) {
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    return dir;
  }

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("NavigationLink destination이 소문자 변수명(동적 표현식)인 경우 DYNAMIC_NAV(conf 0.3)를 emit한다", async () => {
    // NavigationLink(destination: dynamicDest()) — 소문자로 시작 → 변수명 → 동적 표현식
    const dir = mkProject({
      "Sources/HomeScreen.swift": `
import SwiftUI
@main
struct MyApp: App {
  var body: some Scene {
    WindowGroup { HomeScreen() }
  }
}
struct HomeScreen: View {
  var body: some View {
    NavigationLink(destination: dynamicDest()) {
      Text("Go Dynamic")
    }
  }
}
`,
    });
    const symbolTable = await buildSwiftSymbolTable(dir);
    const graph = await discoverIOSNavGraph(dir, symbolTable);

    // 동적 destination 케이스: DYNAMIC_NAV 엣지이어야 한다 (현재는 스킵됨 — Red)
    const dynEdge = graph.edges.find((e) => e.from === "HomeScreen");
    expect(dynEdge).toBeDefined();
    const dynDiag = dynEdge!.diagnostics.find((d) => d.code === "DYNAMIC_NAV");
    expect(dynDiag).toBeDefined();
    expect(dynEdge!.confidence).toBe(0.3);
    expect(dynEdge!.to).toBeNull();
  });

  it("NavigationLink destination이 대문자 심볼인데 심볼 테이블에 없으면 UNRESOLVED_NAV를 emit한다 (변경 없음)", async () => {
    const dir = mkProject({
      "Sources/HomeScreen.swift": `
import SwiftUI
@main
struct MyApp: App {
  var body: some Scene {
    WindowGroup { HomeScreen() }
  }
}
struct HomeScreen: View {
  var body: some View {
    NavigationLink(destination: UnknownScreen()) {
      Text("Go Unknown")
    }
  }
}
`,
    });
    const symbolTable = await buildSwiftSymbolTable(dir);
    const graph = await discoverIOSNavGraph(dir, symbolTable);

    const edge = graph.edges.find((e) => e.from === "HomeScreen");
    expect(edge).toBeDefined();
    const unresDiag = edge!.diagnostics.find((d) => d.code === "UNRESOLVED_NAV");
    expect(unresDiag).toBeDefined();
    expect(edge!.confidence).toBe(0.3);
  });
});
