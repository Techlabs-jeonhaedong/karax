import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { discoverRNNavGraph, readRNAppName } from "../discover/navGraph.js";
import { buildSymbolTable } from "../parse/scanner.js";
import { buildScreenIR as buildRNScreenIR } from "../ir/builder.js";

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

describe("discoverRNNavGraph — trigger.elementRef", () => {
  it("HomeScreen → ListScreen 엣지의 trigger.elementRef가 존재한다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge).toBeDefined();
    expect(listEdge!.trigger.elementRef).toBeDefined();
  });

  it("HomeScreen → ListScreen 엣지의 elementRef.file이 HomeScreen.tsx 상대경로다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge!.trigger.elementRef!.file).toBe("src/screens/HomeScreen.tsx");
  });

  it("HomeScreen → ListScreen 엣지의 elementRef.line이 onPress attr 라인(68)이다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const listEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "ListScreen"
    );
    expect(listEdge!.trigger.elementRef!.line).toBe(68);
  });

  it("HomeScreen → DetailScreen 엣지의 elementRef가 존재하고 올바른 라인이다", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const detailEdge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen"
    );
    expect(detailEdge!.trigger.elementRef).toBeDefined();
    expect(detailEdge!.trigger.elementRef!.line).toBe(76);
  });

  it("elementRef.file 형식이 buildScreenIR IR 노드 sourceRef.file 형식과 동일하다 (매칭 키 정합성)", async () => {
    const symbolTable = await buildSymbolTable(FIXTURE_PATH);
    const graph = await discoverRNNavGraph(FIXTURE_PATH, symbolTable);

    const elementRefFiles = graph.edges
      .map((e) => e.trigger.elementRef?.file)
      .filter((f): f is string => f !== undefined);
    expect(elementRefFiles.length).toBeGreaterThan(0);

    const ir = await buildRNScreenIR({ projectPath: FIXTURE_PATH, mockSeed: 42 }, "HomeScreen");

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
    const irTsxFiles = irFiles.filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    if (irTsxFiles.length === 0) return;

    // 형식 비교: 둘 다 상대경로(src/로 시작)
    for (const refFile of elementRefFiles) {
      expect(refFile.startsWith("src/")).toBe(true);
    }
    for (const irFile of irTsxFiles) {
      expect(irFile.startsWith("src/")).toBe(true);
    }
  });
});

describe("readRNAppName (react-native-basic 픽스처)", () => {
  it("app.json 또는 package.json에서 앱 이름을 반환한다", async () => {
    const appName = await readRNAppName(FIXTURE_PATH);
    expect(typeof appName).toBe("string");
    expect(appName!.length).toBeGreaterThan(0);
  });
});

// ── DYNAMIC_NAV vs UNRESOLVED_NAV 분리 — 합성 임시 픽스처 ────────────────────

describe("RN navGraph — DYNAMIC_NAV vs UNRESOLVED_NAV 진단 코드 분리", () => {
  const tmpDirs: string[] = [];

  function mkProject(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-rn-nav-"));
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

  it("navigate 인자가 변수(동적 표현식)인 경우 DYNAMIC_NAV(conf 0.3)를 emit한다", async () => {
    // navigation.navigate(routeName) — string_fragment 없는 변수 참조
    const dir = mkProject({
      "App.tsx": `
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './src/screens/HomeScreen';
const Stack = createNativeStackNavigator();
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
`,
      "src/screens/HomeScreen.tsx": `
import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
export default function HomeScreen({ navigation }: any) {
  const routeName = getNextRoute();
  return (
    <TouchableOpacity onPress={() => navigation.navigate(routeName)}>
      <Text>Go Dynamic</Text>
    </TouchableOpacity>
  );
}
`,
    });
    const symbolTable = await buildSymbolTable(dir);
    const graph = await discoverRNNavGraph(dir, symbolTable);

    // 동적 인자 케이스: DYNAMIC_NAV이어야 한다 (현재는 조용히 누락 — Red)
    const dynEdge = graph.edges.find((e) => e.from === "HomeScreen");
    expect(dynEdge).toBeDefined();
    const dynDiag = dynEdge!.diagnostics.find((d) => d.code === "DYNAMIC_NAV");
    expect(dynDiag).toBeDefined();
    expect(dynEdge!.confidence).toBe(0.3);
    expect(dynEdge!.to).toBeNull();
  });

  it("navigate 인자가 정적 문자열인데 routeMap에 없으면 UNRESOLVED_NAV를 emit한다 (변경 없음)", async () => {
    const dir = mkProject({
      "App.tsx": `
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './src/screens/HomeScreen';
const Stack = createNativeStackNavigator();
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
`,
      "src/screens/HomeScreen.tsx": `
import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
export default function HomeScreen({ navigation }: any) {
  return (
    <TouchableOpacity onPress={() => navigation.navigate('UnknownScreen')}>
      <Text>Go Unknown</Text>
    </TouchableOpacity>
  );
}
`,
    });
    const symbolTable = await buildSymbolTable(dir);
    const graph = await discoverRNNavGraph(dir, symbolTable);

    const edge = graph.edges.find((e) => e.from === "HomeScreen");
    expect(edge).toBeDefined();
    const unresDiag = edge!.diagnostics.find((d) => d.code === "UNRESOLVED_NAV");
    expect(unresDiag).toBeDefined();
    expect(edge!.confidence).toBe(0.6);
  });
});
