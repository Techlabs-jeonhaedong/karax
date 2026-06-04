import { access } from "fs/promises";
import path from "path";
import type {
  FrameworkAdapter,
  FrameworkEvidence,
  AdapterContext,
  ScreenSummary,
} from "@sfc/adapter-api";
import type { IRDocument } from "@sfc/core";
import { buildSwiftSymbolTable } from "./parse/scanner.js";
import { discoverSwiftRouteGraph } from "./discover/routeGraph.js";
import { findSwiftHeuristicCandidates } from "./discover/heuristic.js";
import { buildSwiftScreenIR } from "./ir/builder.js";

// ── 유틸 ─────────────────────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function classNameToTitle(name: string): string {
  return name.replace(/([A-Z])/g, " $1").trim();
}

// ── iosAdapter ────────────────────────────────────────────────────────────────

export const iosAdapter: FrameworkAdapter = {
  id: "ios",

  async detect(projectPath: string) {
    const evidence: FrameworkEvidence[] = [];

    // *.xcodeproj 디렉토리 확인
    const { readdir } = await import("fs/promises");
    let entries: string[] = [];
    try {
      entries = await readdir(projectPath);
    } catch {
      return { matches: false, confidence: 0, evidence };
    }

    const hasXcodeproj = entries.some(e => e.endsWith(".xcodeproj"));
    const hasPackageSwift = await pathExists(path.join(projectPath, "Package.swift"));
    const hasSwiftFiles = await (async () => {
      const sourcesDir = path.join(projectPath, "Sources");
      try {
        const files = await readdir(sourcesDir, { recursive: true } as any);
        return Array.isArray(files) && files.some((f: any) => String(f).endsWith(".swift"));
      } catch {
        // fallback: 최상위에 swift 파일이 있는지
        return entries.some(e => e.endsWith(".swift"));
      }
    })();

    if (hasXcodeproj) {
      evidence.push({ type: "file", description: "*.xcodeproj directory found" });
    }
    if (hasPackageSwift) {
      evidence.push({ type: "file", description: "Package.swift found" });
    }
    if (hasSwiftFiles) {
      evidence.push({ type: "file", description: "*.swift source files found" });
    }

    if (!hasXcodeproj && !hasPackageSwift) {
      return { matches: false, confidence: 0.1, evidence };
    }

    if (!hasSwiftFiles) {
      return { matches: false, confidence: 0.2, evidence };
    }

    const confidence = hasXcodeproj ? 0.95 : 0.85;
    return { matches: true, confidence, evidence };
  },

  async discoverScreens(ctx: AdapterContext): Promise<ScreenSummary[]> {
    const { projectPath, includeCandidates = true } = ctx;

    const symbolTable = await buildSwiftSymbolTable(projectPath);
    const { routes } = await discoverSwiftRouteGraph(projectPath, symbolTable);
    const routeClassSet = new Set(routes.map(r => r.className));

    const screens: ScreenSummary[] = [];

    // route → ScreenSummary
    for (const route of routes) {
      const info = symbolTable.structs.get(route.className);
      screens.push({
        id: route.className,
        title: classNameToTitle(route.className),
        discovery: "route",
        confidence: 1.0,
        sourceRef: info
          ? { file: info.file, line: info.line, symbol: route.className }
          : undefined,
      });
    }

    // heuristic candidate
    if (includeCandidates) {
      const candidates = findSwiftHeuristicCandidates(symbolTable, routeClassSet);
      for (const c of candidates) {
        screens.push({
          id: c.className,
          title: classNameToTitle(c.className),
          discovery: "candidate",
          confidence: 0.6,
          sourceRef: {
            file: c.structInfo.file,
            line: c.structInfo.line,
            symbol: c.className,
          },
        });
      }
    }

    return screens;
  },

  async buildScreenIR(ctx: AdapterContext, screenId: string): Promise<IRDocument> {
    return buildSwiftScreenIR(ctx, screenId);
  },
};

export const ADAPTER_ID = "ios" as const;
export { classNameToTitle };
