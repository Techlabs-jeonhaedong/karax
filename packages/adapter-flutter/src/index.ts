import { access } from "fs/promises";
import path from "path";
import type {
  FrameworkAdapter,
  FrameworkEvidence,
  AdapterContext,
  ScreenSummary,
} from "@sfc/adapter-api";
import type { IRDocument } from "@sfc/core";
import { readPackageName, hasFlutterDependency } from "./parse/pubspec.js";
import { buildSymbolTable } from "./parse/scanner.js";
import { discoverRouteGraph } from "./discover/routeGraph.js";
import { findHeuristicCandidates } from "./discover/heuristic.js";
import { buildScreenIR as _buildScreenIR } from "./ir/builder.js";

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/** PascalCase 클래스명을 사람이 읽기 좋은 title로 변환한다.
 *  HomeScreen → "Home Screen", ListScreen → "List Screen"
 */
function classNameToTitle(className: string): string {
  return className
    .replace(/([A-Z])/g, " $1")
    .trim();
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ── FlutterAdapter 구현 ───────────────────────────────────────────────────────

export const flutterAdapter: FrameworkAdapter = {
  id: "flutter",

  async detect(projectPath: string) {
    const evidence: FrameworkEvidence[] = [];

    // pubspec.yaml 존재 확인
    const pubspecPath = path.join(projectPath, "pubspec.yaml");
    if (!(await pathExists(pubspecPath))) {
      return { matches: false, confidence: 0, evidence };
    }
    evidence.push({ type: "file", description: "pubspec.yaml found" });

    // flutter 의존성 확인
    const hasFlutter = await hasFlutterDependency(projectPath);
    if (!hasFlutter) {
      return { matches: false, confidence: 0.2, evidence };
    }
    evidence.push({ type: "dependency", description: "flutter SDK dependency in pubspec.yaml" });

    // lib/ 디렉토리 확인
    const libPath = path.join(projectPath, "lib");
    if (await pathExists(libPath)) {
      evidence.push({ type: "file", description: "lib/ directory found" });
    }

    return { matches: true, confidence: 0.95, evidence };
  },

  async discoverScreens(ctx: AdapterContext): Promise<ScreenSummary[]> {
    const { projectPath, includeCandidates = true } = ctx;

    // 패키지명 읽기
    let packageName: string;
    try {
      packageName = await readPackageName(projectPath);
    } catch {
      packageName = "";
    }

    // 심볼 테이블 구축
    const symbolTable = await buildSymbolTable(projectPath, packageName);

    // Route-graph 발견
    const { routes, diagnostics } = await discoverRouteGraph(projectPath, symbolTable);

    const screens: ScreenSummary[] = [];
    const routeClassSet = new Set(routes.map((r) => r.className));

    // route → ScreenSummary 변환
    for (const route of routes) {
      const classInfo = symbolTable.classes.get(route.className);
      const screen: ScreenSummary = {
        id: route.className,
        title: classNameToTitle(route.className),
        discovery: "route",
        confidence: 1.0,
        sourceRef: classInfo
          ? {
              file: classInfo.file,
              line: classInfo.line,
              symbol: route.className,
            }
          : undefined,
      };
      screens.push(screen);
    }

    // Heuristic 발견
    if (includeCandidates) {
      const candidates = findHeuristicCandidates(symbolTable, routeClassSet);
      for (const candidate of candidates) {
        screens.push({
          id: candidate.className,
          title: classNameToTitle(candidate.className),
          discovery: "candidate",
          confidence: 0.6,
          sourceRef: {
            file: candidate.classInfo.file,
            line: candidate.classInfo.line,
            symbol: candidate.className,
          },
        });
      }
    }

    return screens;
  },

  async buildScreenIR(ctx: AdapterContext, screenId: string): Promise<IRDocument> {
    return _buildScreenIR(ctx, screenId);
  },
};

// diagnostics는 IRDocument.diagnostics 채널로 노출됨
export { classNameToTitle };
export const ADAPTER_ID = "flutter" as const;
