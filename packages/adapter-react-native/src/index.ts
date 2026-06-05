/**
 * @sfc/adapter-react-native — React Native 화면 발견 + Tier 2 정적 IR
 *
 * FrameworkAdapter 인터페이스 구현:
 * - detect(): package.json에 react-native 의존성 확인
 * - discoverScreens(): 라우트 그래프 + heuristic 발견
 * - buildScreenIR(): JSX→IR Tier 2 변환
 */

import path from "path";
import { readFile } from "fs/promises";
import type { FrameworkAdapter, AdapterContext, ScreenSummary, FrameworkEvidence, NavigationGraph } from "@sfc/adapter-api";
import type { IRDocument } from "@sfc/core";
import { buildSymbolTable } from "./parse/scanner.js";
import { discoverRouteGraph } from "./discover/routeGraph.js";
import { findHeuristicCandidates } from "./discover/heuristic.js";
import { buildScreenIR } from "./ir/builder.js";
import { discoverRNNavGraph, readRNAppName } from "./discover/navGraph.js";

export const ADAPTER_ID = "react-native" as const;

// ── detect ────────────────────────────────────────────────────────────────────

async function detect(projectPath: string): Promise<{
  matches: boolean;
  confidence: number;
  evidence: FrameworkEvidence[];
}> {
  const evidence: FrameworkEvidence[] = [];

  // package.json에 react-native 의존성 존재 여부
  const pkgPath = path.join(projectPath, "package.json");
  let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    const raw = await readFile(pkgPath, "utf-8");
    pkgJson = JSON.parse(raw);
  } catch {
    return { matches: false, confidence: 0, evidence: [] };
  }

  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const hasRN = "react-native" in deps;

  if (hasRN) {
    evidence.push({
      type: "dependency",
      description: `package.json dependencies에 react-native 존재 (${deps["react-native"]})`,
    });
  } else {
    return { matches: false, confidence: 0, evidence: [] };
  }

  // index.js + AppRegistry 확인 (선택)
  try {
    const indexSrc = await readFile(path.join(projectPath, "index.js"), "utf-8");
    if (indexSrc.includes("AppRegistry")) {
      evidence.push({
        type: "file",
        description: "index.js에 AppRegistry.registerComponent 존재",
      });
    }
  } catch {
    // index.js 없어도 react-native가 있으면 RN 프로젝트
  }

  const confidence = evidence.length >= 2 ? 0.95 : 0.8;
  return { matches: true, confidence, evidence };
}

// ── discoverScreens ───────────────────────────────────────────────────────────

async function discoverScreens(ctx: AdapterContext): Promise<ScreenSummary[]> {
  const { projectPath, includeCandidates = true } = ctx;
  const summaries: ScreenSummary[] = [];

  // 심볼 테이블 구축
  const symbolTable = await buildSymbolTable(projectPath);

  // 라우트 그래프 발견
  const { routes } = await discoverRouteGraph(projectPath, symbolTable);
  const routeComponentNames = new Set(routes.map(r => r.componentName));

  for (const route of routes) {
    const compInfo = symbolTable.components.get(route.componentName);
    summaries.push({
      id: route.componentName,
      title: route.name,
      discovery: "route",
      confidence: 0.9,
      sourceRef: compInfo
        ? { file: compInfo.file, line: compInfo.line, symbol: route.componentName }
        : undefined,
    });
  }

  // heuristic 후보 발견
  if (includeCandidates) {
    const candidates = findHeuristicCandidates(symbolTable, routeComponentNames);
    for (const candidate of candidates) {
      summaries.push({
        id: candidate.componentName,
        title: candidate.componentName,
        discovery: "candidate",
        confidence: 0.5,
        sourceRef: {
          file: candidate.componentInfo.file,
          line: candidate.componentInfo.line,
          symbol: candidate.componentName,
        },
      });
    }
  }

  return summaries;
}

// ── FrameworkAdapter 구현 ─────────────────────────────────────────────────────

export const reactNativeAdapter: FrameworkAdapter = {
  id: ADAPTER_ID,
  detect,
  discoverScreens,
  buildScreenIR: (ctx: AdapterContext, screenId: string): Promise<IRDocument> =>
    buildScreenIR(ctx, screenId),

  async discoverNavigation(ctx: AdapterContext): Promise<NavigationGraph> {
    const symbolTable = await buildSymbolTable(ctx.projectPath);
    return discoverRNNavGraph(ctx.projectPath, symbolTable);
  },

  async readAppName(ctx: AdapterContext): Promise<string | undefined> {
    return readRNAppName(ctx.projectPath);
  },
};

export default reactNativeAdapter;
