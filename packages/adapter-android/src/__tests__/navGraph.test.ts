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
import { describe, expect, it, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
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

// ── DYNAMIC_NAV (콜백 간접 전달) + UNRESOLVED_NAV 분리 — 합성 임시 픽스처 ───

describe("Android navGraph — DYNAMIC_NAV (콜백 3단계 간접 전달) 진단 분리", () => {
  const tmpDirs: string[] = [];

  function mkProject(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-android-nav-"));
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

  it("NavHost에 없는 콜백 파라미터로 Button 클릭 — DYNAMIC_NAV diagnostic(conf 0.3), 엣지는 생성 안 됨", async () => {
    // HomeScreen은 NavHost에서 onNavigate 콜백을 전달받는다.
    // 그런데 NavHost 코드에는 HomeScreen(onNavigate = { ... }) 람다가 없다 — 3단계 간접 전달.
    // 현재는 조용히 누락 → Red: DYNAMIC_NAV diagnostic이 graph.diagnostics에 있어야 한다.
    const dir = mkProject({
      "app/src/main/java/com/example/AppNavHost.kt": `
package com.example

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

object AppRoutes {
    const val HOME = "home"
}

@Composable
fun AppNavHost() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = AppRoutes.HOME) {
        composable(route = AppRoutes.HOME) {
            // onNavigate 콜백은 NavHost가 직접 주입하지 않음 (3단계 이상 간접 전달)
            HomeScreen()
        }
    }
}
`,
      "app/src/main/java/com/example/screens/HomeScreen.kt": `
package com.example.screens

import androidx.compose.material.Button
import androidx.compose.material.Text
import androidx.compose.runtime.Composable

@Composable
fun HomeScreen(onNavigate: () -> Unit = {}) {
    Button(onClick = onNavigate) {
        Text("Go Next")
    }
}
`,
    });

    const symbolTable = await buildSymbolTable(dir);
    const graph = await discoverAndroidNavGraph(dir, symbolTable);

    // 3단계 간접 전달 → DYNAMIC_NAV diagnostic이 graph.diagnostics에 있어야 한다 (현재는 없음 — Red)
    const dynDiag = graph.diagnostics.find((d) => d.code === "DYNAMIC_NAV");
    expect(dynDiag).toBeDefined();

    // 엣지는 생성되지 않아야 한다 (목적지를 알 수 없으므로)
    const homeEdges = graph.edges.filter((e) => e.from === "HomeScreen");
    expect(homeEdges).toHaveLength(0);
  });

  it("NavHost에 직접 람다 주입된 콜백은 정상 엣지 생성 (DYNAMIC_NAV 오탐 없음)", async () => {
    // HomeScreen(onNavigate = { navController.navigate(AppRoutes.DETAIL) }) — 정상 케이스
    const dir = mkProject({
      "app/src/main/java/com/example/AppNavHost.kt": `
package com.example

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

object AppRoutes {
    const val HOME = "home"
    const val DETAIL = "detail"
}

@Composable
fun AppNavHost() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = AppRoutes.HOME) {
        composable(route = AppRoutes.HOME) {
            HomeScreen(onNavigate = { navController.navigate(AppRoutes.DETAIL) })
        }
        composable(route = AppRoutes.DETAIL) {
            DetailScreen()
        }
    }
}
`,
      "app/src/main/java/com/example/screens/HomeScreen.kt": `
package com.example.screens

import androidx.compose.material.Button
import androidx.compose.material.Text
import androidx.compose.runtime.Composable

@Composable
fun HomeScreen(onNavigate: () -> Unit = {}) {
    Button(onClick = onNavigate) {
        Text("Go Detail")
    }
}
`,
      "app/src/main/java/com/example/screens/DetailScreen.kt": `
package com.example.screens

import androidx.compose.runtime.Composable
import androidx.compose.material.Text

@Composable
fun DetailScreen() {
    Text("Detail")
}
`,
    });

    const symbolTable = await buildSymbolTable(dir);
    const graph = await discoverAndroidNavGraph(dir, symbolTable);

    // 정상 push 엣지가 생성돼야 한다
    const edge = graph.edges.find((e) => e.from === "HomeScreen" && e.to === "DetailScreen");
    expect(edge).toBeDefined();
    expect(edge!.action).toBe("push");

    // DYNAMIC_NAV diagnostic이 없어야 한다 (오탐 없음)
    const dynDiag = graph.diagnostics.find((d) => d.code === "DYNAMIC_NAV");
    expect(dynDiag).toBeUndefined();
  });

  it("로컬 람다 onClick(nav과 무관한 콜백)은 DYNAMIC_NAV 오탐 없음", async () => {
    // HomeScreen에서 onClick = onLocalAction — 파라미터지만 네비게이션과 무관한 로컬 액션
    // NavHost에서 직접 람다 주입도 없음
    const dir = mkProject({
      "app/src/main/java/com/example/AppNavHost.kt": `
package com.example

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

object AppRoutes {
    const val HOME = "home"
}

@Composable
fun AppNavHost() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = AppRoutes.HOME) {
        composable(route = AppRoutes.HOME) {
            HomeScreen()
        }
    }
}
`,
      "app/src/main/java/com/example/screens/HomeScreen.kt": `
package com.example.screens

import androidx.compose.material.Button
import androidx.compose.material.Text
import androidx.compose.runtime.Composable

@Composable
fun HomeScreen() {
    val onLocalAction = { println("local") }
    Button(onClick = onLocalAction) {
        Text("Do something")
    }
}
`,
    });

    const symbolTable = await buildSymbolTable(dir);
    const graph = await discoverAndroidNavGraph(dir, symbolTable);

    // 로컬 변수(파라미터가 아님)이므로 DYNAMIC_NAV 오탐 없음
    const dynDiag = graph.diagnostics.find((d) => d.code === "DYNAMIC_NAV");
    expect(dynDiag).toBeUndefined();
  });
});
