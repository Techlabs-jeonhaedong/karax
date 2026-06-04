/**
 * @sfc/adapter-android — Android Compose 어댑터
 *
 * FrameworkAdapter 구현:
 * - detect: settings.gradle(.kts) + AndroidManifest.xml
 * - discoverScreens: NavHost route-graph + heuristic (@Composable *Screen/Page 접미사)
 * - buildScreenIR: Compose → IR 변환 (Tier 2 정적)
 */

import { access } from "fs/promises";
import path from "path";
import type {
  FrameworkAdapter,
  FrameworkEvidence,
  AdapterContext,
  ScreenSummary,
} from "@sfc/adapter-api";
import type { IRDocument } from "@sfc/core";
import { buildSymbolTable } from "./parse/scanner.js";
import { parseManifest, readProjectName } from "./parse/manifest.js";
import { discoverRouteGraph } from "./discover/routeGraph.js";
import { findHeuristicCandidates } from "./discover/heuristic.js";
import { buildScreenIR as _buildScreenIR } from "./ir/builder.js";

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function classNameToTitle(name: string): string {
  return name.replace(/([A-Z])/g, " $1").trim();
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ── AndroidAdapter 구현 ───────────────────────────────────────────────────────

export const androidAdapter: FrameworkAdapter = {
  id: "android",

  async detect(projectPath: string) {
    const evidence: FrameworkEvidence[] = [];

    // settings.gradle(.kts) 존재 확인
    const settingsKts = path.join(projectPath, "settings.gradle.kts");
    const settingsGroovy = path.join(projectPath, "settings.gradle");
    const hasSetting =
      (await pathExists(settingsKts)) || (await pathExists(settingsGroovy));

    if (!hasSetting) {
      return { matches: false, confidence: 0, evidence };
    }
    evidence.push({ type: "file", description: "settings.gradle(.kts) found" });

    // AndroidManifest.xml 존재 확인
    const manifestPath = path.join(
      projectPath,
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    if (!(await pathExists(manifestPath))) {
      return { matches: false, confidence: 0.2, evidence };
    }
    evidence.push({ type: "file", description: "AndroidManifest.xml found" });

    // build.gradle(.kts) 존재 확인
    const buildKts = path.join(projectPath, "build.gradle.kts");
    const buildGroovy = path.join(projectPath, "build.gradle");
    if ((await pathExists(buildKts)) || (await pathExists(buildGroovy))) {
      evidence.push({ type: "file", description: "build.gradle(.kts) found" });
    }

    // app/src/main/java 또는 kotlin 디렉토리
    const javaDir = path.join(projectPath, "app", "src", "main", "java");
    const kotlinDir = path.join(projectPath, "app", "src", "main", "kotlin");
    if ((await pathExists(javaDir)) || (await pathExists(kotlinDir))) {
      evidence.push({
        type: "file",
        description: "app/src/main/java or kotlin directory found",
      });
    }

    return { matches: true, confidence: 0.95, evidence };
  },

  async discoverScreens(ctx: AdapterContext): Promise<ScreenSummary[]> {
    const { projectPath, includeCandidates = true } = ctx;

    let symbolTable;
    try {
      symbolTable = await buildSymbolTable(projectPath);
    } catch {
      return [];
    }

    if (symbolTable.composables.size === 0) return [];

    // Route-graph 발견
    const { routes } = await discoverRouteGraph(projectPath, symbolTable);
    const routeNameSet = new Set(routes.map((r) => r.composableName));

    const screens: ScreenSummary[] = [];

    for (const route of routes) {
      const info = symbolTable.composables.get(route.composableName);
      screens.push({
        id: route.composableName,
        title: classNameToTitle(route.composableName),
        discovery: "route",
        confidence: 1.0,
        sourceRef: info
          ? { file: info.file, line: info.line, symbol: route.composableName }
          : undefined,
      });
    }

    // Heuristic 발견
    if (includeCandidates) {
      const candidates = findHeuristicCandidates(symbolTable, routeNameSet);
      for (const c of candidates) {
        screens.push({
          id: c.composableName,
          title: classNameToTitle(c.composableName),
          discovery: "candidate",
          confidence: 0.6,
          sourceRef: {
            file: c.composableInfo.file,
            line: c.composableInfo.line,
            symbol: c.composableName,
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

export { classNameToTitle };
export const ADAPTER_ID = "android" as const;
