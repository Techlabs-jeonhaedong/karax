import { describe, it, expect, afterAll } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { discoverFlutterNavGraph } from "../discover/navGraph.js";
import { buildSymbolTable } from "../parse/scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GETX_FIXTURE = path.resolve(__dirname, "../../../..", "fixtures", "flutter-getx");
const NAV_ADV_FIXTURE = path.resolve(__dirname, "fixtures", "navigator-advanced");

async function navGraphOf(projectPath: string) {
  const symbolTable = await buildSymbolTable(projectPath, "fixture");
  return discoverFlutterNavGraph(projectPath, symbolTable);
}

// ── 단계 3: 표준 Navigator 확장 (navigator-advanced 합성 픽스처) ─────────────

describe("Navigator 확장 — navigator-advanced", () => {
  it("pushReplacementNamed가 replace 액션 엣지로 추출된다 (routes 테이블 해석)", async () => {
    const graph = await navGraphOf(NAV_ADV_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "AScreen" && e.to === "BScreen" && e.action === "replace" && e.trigger.label === "Replace Named B"
    );
    expect(edge).toBeDefined();
  });

  it("Navigator.of(context).push 체인이 push 엣지로 추출된다", async () => {
    const graph = await navGraphOf(NAV_ADV_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "AScreen" && e.to === "BScreen" && e.action === "push" && e.trigger.label === "Of Push B"
    );
    expect(edge).toBeDefined();
  });

  it("같은 클래스 분리 메서드(_clearToB) 안의 pushAndRemoveUntil이 핸들러 트리거와 연결된다", async () => {
    const graph = await navGraphOf(NAV_ADV_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "AScreen" && e.to === "BScreen" && e.trigger.label === "Clear To B"
    );
    expect(edge).toBeDefined();
    expect(edge!.action).toBe("replace");
    expect(edge!.fromKind).toBe("screen");
    // 트리거(버튼)는 a_screen.dart의 onPressed 위치
    expect(edge!.trigger.elementRef?.file).toBe("lib/screens/a_screen.dart");
  });

  it("maybePop이 pop 엣지로 추출된다", async () => {
    const graph = await navGraphOf(NAV_ADV_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "AScreen" && e.action === "pop" && e.trigger.label === "Maybe Back"
    );
    expect(edge).toBeDefined();
    expect(edge!.trigger.kind).toBe("back");
  });

  it("모든 엣지에 fromRef(실제 호출 위치)가 기록된다", async () => {
    const graph = await navGraphOf(NAV_ADV_FIXTURE);
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edge.fromRef?.file).toBeTruthy();
      expect(edge.fromRef?.line).toBeGreaterThan(0);
    }
  });
});

// ── 단계 4·5·6: GetX 호출 + 핸들러 간접 추적 + from 특정 (flutter-getx) ──────

describe("GetX 네비게이션 — flutter-getx 픽스처", () => {
  it("entryScreenId가 initialRoute 상수 해석으로 SplashScreen이 된다", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    expect(graph.entryScreenId).toBe("SplashScreen");
  });

  it("분리 메서드(_goHome)의 Get.offAllNamed가 SplashScreen→HomeScreen replace 엣지가 된다", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "SplashScreen" && e.to === "HomeScreen"
    );
    expect(edge).toBeDefined();
    expect(edge!.action).toBe("replace");
    expect(edge!.trigger.label).toBe("Start");
    expect(edge!.fromKind).toBe("screen");
  });

  it("인라인 Get.toNamed(상수)가 HomeScreen→DetailScreen push 엣지가 된다", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "DetailScreen" && e.action === "push"
    );
    expect(edge).toBeDefined();
    expect(edge!.trigger.label).toBe("Open Detail");
    expect(edge!.trigger.elementRef?.file).toBe("lib/screens/home_screen.dart");
  });

  it("컨트롤러 메서드 경유(onTap: () => controller.openSettings())가 HomeScreen→SettingsScreen 엣지가 된다", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "HomeScreen" && e.to === "SettingsScreen"
    );
    expect(edge).toBeDefined();
    // 트리거는 화면의 GestureDetector(onTap) 위치
    expect(edge!.trigger.elementRef?.file).toBe("lib/screens/home_screen.dart");
    expect(edge!.trigger.label).toBe("Open Settings");
    // 실제 호출 위치는 컨트롤러 파일
    expect(edge!.fromRef?.file).toBe("lib/controller/home_controller.dart");
    expect(edge!.fromKind).toBe("screen");
  });

  it("Get.back이 DetailScreen pop 엣지가 된다", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "DetailScreen" && e.action === "pop"
    );
    expect(edge).toBeDefined();
    expect(edge!.trigger.kind).toBe("back");
  });

  it("Get.to(() => 위젯) 빌더가 SettingsScreen→DetailScreen push 엣지가 된다", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.from === "SettingsScreen" && e.to === "DetailScreen"
    );
    expect(edge).toBeDefined();
    expect(edge!.action).toBe("push");
    expect(edge!.trigger.label).toBe("Open Detail Directly");
  });

  it("유틸(SessionUtil) 안의 Get.offAllNamed는 (global) from으로 보존된다 — 엣지 손실 0", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    const edge = graph.edges.find(
      (e) => e.fromKind === "global" && e.to === "SplashScreen"
    );
    expect(edge).toBeDefined();
    expect(edge!.from).toBe("(global)");
    expect(edge!.action).toBe("replace");
    expect(edge!.fromRef?.file).toBe("lib/util/session_util.dart");
  });

  it("모든 GetX 엣지에 fromRef가 기록된다", async () => {
    const graph = await navGraphOf(GETX_FIXTURE);
    expect(graph.edges.length).toBeGreaterThanOrEqual(6);
    for (const edge of graph.edges) {
      expect(edge.fromRef?.file).toBeTruthy();
    }
  });
});

// ── DYNAMIC_NAV vs UNRESOLVED_NAV 분리 — 합성 임시 픽스처 ───────────────────

describe("Flutter navGraph — DYNAMIC_NAV vs UNRESOLVED_NAV 진단 코드 분리", () => {
  let tmpDir: string;

  function mkProject(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-flutter-nav-"));
    for (const [relPath, content] of Object.entries(files)) {
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    return dir;
  }

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("routeRaw만 있는 동적 인자 케이스는 DYNAMIC_NAV(conf 0.3)를 emit한다", async () => {
    // Navigator.pushNamed(context, dynamicRoute) — 변수 표현식이라 routeRaw만 남음
    tmpDir = mkProject({
      "pubspec.yaml": "name: test_app\nflutter:\n  uses-material-design: true\n",
      "lib/screens/home_screen.dart": `
import 'package:flutter/material.dart';
class HomeScreen extends StatelessWidget {
  final String dynamicRoute;
  const HomeScreen({required this.dynamicRoute, super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ElevatedButton(
        onPressed: () {
          Navigator.pushNamed(context, dynamicRoute);
        },
        child: const Text('Go Dynamic'),
      ),
    );
  }
}
`,
    });
    const symbolTable = await buildSymbolTable(tmpDir, "test_app");
    const graph = await discoverFlutterNavGraph(tmpDir, symbolTable);

    // routeRaw가 있는 엣지: DYNAMIC_NAV이어야 한다 (현재는 UNRESOLVED_NAV — Red)
    const dynEdge = graph.edges.find((e) => e.from === "HomeScreen");
    expect(dynEdge).toBeDefined();
    const dynDiag = dynEdge!.diagnostics.find((d) => d.code === "DYNAMIC_NAV");
    expect(dynDiag).toBeDefined();
    expect(dynEdge!.confidence).toBe(0.3);
    // UNRESOLVED_NAV는 없어야 한다
    const unresDiag = dynEdge!.diagnostics.find((d) => d.code === "UNRESOLVED_NAV");
    expect(unresDiag).toBeUndefined();
  });

  it("named 라우트 테이블 미스는 UNRESOLVED_NAV(conf 0.6)를 emit한다 (변경 없음)", async () => {
    const dir = mkProject({
      "pubspec.yaml": "name: test_app\nflutter:\n  uses-material-design: true\n",
      "lib/screens/home_screen.dart": `
import 'package:flutter/material.dart';
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ElevatedButton(
        onPressed: () {
          Navigator.pushNamed(context, '/unknown_route');
        },
        child: const Text('Go Unknown'),
      ),
    );
  }
}
`,
    });
    const symbolTable = await buildSymbolTable(dir, "test_app");
    const graph = await discoverFlutterNavGraph(dir, symbolTable);

    const edge = graph.edges.find((e) => e.from === "HomeScreen");
    expect(edge).toBeDefined();
    const unresDiag = edge!.diagnostics.find((d) => d.code === "UNRESOLVED_NAV");
    expect(unresDiag).toBeDefined();
    expect(edge!.confidence).toBe(0.6);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
