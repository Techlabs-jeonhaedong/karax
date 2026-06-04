/**
 * @sfc/adapter-android — Android Compose + XML layout 어댑터
 *
 * FrameworkAdapter 구현:
 * - detect: settings.gradle(.kts) + AndroidManifest.xml
 * - discoverScreens:
 *     Compose 있음: NavHost route-graph + heuristic (@Composable *Screen/Page 접미사)
 *     XML 있음: setContentView(R.layout.xxx) → route, 미참조 layout → candidate
 *     혼합: 둘 다
 * - buildScreenIR:
 *     Compose screenId → Compose IR 변환
 *     XML layout screenId → XML layout IR 변환
 */

import { access, readdir } from "fs/promises";
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
import {
  discoverXmlLayouts,
  buildXmlScreenIR,
} from "./xml/xmlLayoutAdapter.js";

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

/** res/layout/ 디렉토리에 XML 파일이 1개 이상 있는지 확인한다 */
async function detectXmlLayouts(projectPath: string): Promise<boolean> {
  const layoutDir = path.join(
    projectPath,
    "app",
    "src",
    "main",
    "res",
    "layout"
  );
  try {
    const entries = await readdir(layoutDir);
    return entries.some((e) => e.endsWith(".xml"));
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

    const screens: ScreenSummary[] = [];

    // ── Compose 경로 ────────────────────────────────────────────────────────
    let symbolTable;
    let hasCompose = false;
    try {
      symbolTable = await buildSymbolTable(projectPath);
      hasCompose = symbolTable.composables.size > 0;
    } catch {
      // Kotlin 파일이 없는 프로젝트 (순수 Java/XML)
    }

    if (hasCompose && symbolTable) {
      // Route-graph 발견
      const { routes } = await discoverRouteGraph(projectPath, symbolTable);
      const routeNameSet = new Set(routes.map((r) => r.composableName));

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
    }

    // ── XML layout 경로 ─────────────────────────────────────────────────────
    // Compose가 없거나, XML layout이 있으면 XML 경로도 탐색 (혼합 지원)
    const hasXmlLayouts = await detectXmlLayouts(projectPath);
    if (hasXmlLayouts) {
      const xmlScreens = await discoverXmlLayouts(projectPath);
      // candidate 필터링 (includeCandidates=false이면 route만)
      const filtered = includeCandidates
        ? xmlScreens
        : xmlScreens.filter((s) => s.discovery === "route");
      // Compose에서 이미 발견된 id와 중복 없이 추가
      const existingIds = new Set(screens.map((s) => s.id));
      for (const xs of filtered) {
        if (!existingIds.has(xs.id)) {
          screens.push(xs);
        }
      }
    }

    return screens;
  },

  async buildScreenIR(ctx: AdapterContext, screenId: string): Promise<IRDocument> {
    const { projectPath } = ctx;

    // XML layout screenId 판단: activity_*, layout_*, fragment_* 패턴 또는
    // Compose 심볼 테이블에 없으면 XML 경로 시도
    let symbolTable;
    try {
      symbolTable = await buildSymbolTable(projectPath);
    } catch {
      // Kotlin 없으면 XML 경로
    }

    const isInCompose = symbolTable?.composables.has(screenId) ?? false;

    if (!isInCompose) {
      // XML layout 경로 시도
      const mockSeed = ctx.mockSeed ?? 42;
      return buildXmlScreenIR(projectPath, screenId, mockSeed);
    }

    return _buildScreenIR(ctx, screenId);
  },
};

export { classNameToTitle };
export const ADAPTER_ID = "android" as const;
