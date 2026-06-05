/**
 * builder — buildScreenIR(ctx, screenId) 구현
 *
 * 파이프라인:
 * 1. 심볼 테이블 구축
 * 2. 화면 발견 (route/candidate 판단)
 * 3. ThemeResolver로 designTokens 추출
 * 4. 리소스 로드 (strings.xml, colors.xml)
 * 5. Composable 함수 본문 추출
 * 6. widgetMapper로 IR 변환
 * 7. aggregateScreenConfidence로 confidence 집계
 * 8. IRDocument 조립 + zod 스키마 검증
 */

import type { AdapterContext } from "@karax/adapter-api";
import type { IRDocument, IRNode } from "@karax/core";
import {
  createMockProvider,
  aggregateScreenConfidence,
  parseIRDocument,
  NODE_CONFIDENCE,
} from "@karax/core";
import { buildSymbolTable } from "../parse/scanner.js";
import { loadResources } from "../parse/resources.js";
import { discoverRouteGraph } from "../discover/routeGraph.js";
import { findHeuristicCandidates } from "../discover/heuristic.js";
import { resolveTheme } from "./themeResolver.js";
import { mapComposable } from "./widgetMapper.js";
import type { MapContext } from "./widgetMapper.js";
import { extractFunctionBody } from "./astUtils.js";

// ── 공개 API ──────────────────────────────────────────────────────────────────

export async function buildScreenIR(
  ctx: AdapterContext,
  screenId: string
): Promise<IRDocument> {
  const { projectPath, mockSeed = 42, maxInlineDepth = 6 } = ctx;
  const mock = createMockProvider(mockSeed);
  const diagnostics: Array<{ level: string; code: string; message: string }> =
    [];

  // 1. 심볼 테이블 구축
  const symbolTable = await buildSymbolTable(projectPath);
  try {
  // 2. 화면 발견 — discovery 판단
  const { routes } = await discoverRouteGraph(projectPath, symbolTable);
  const routeNameSet = new Set(routes.map((r) => r.composableName));
  const candidates = findHeuristicCandidates(symbolTable, routeNameSet);
  const candidateNameSet = new Set(candidates.map((c) => c.composableName));

  const isRoute = routeNameSet.has(screenId);
  const discovery: "route" | "candidate" = isRoute ? "route" : "candidate";

  // 화면 존재 확인
  const composableInfo = symbolTable.composables.get(screenId);
  if (!composableInfo) {
    const doc: IRDocument = {
      schemaVersion: "0.1",
      screen: {
        id: screenId,
        discovery: "candidate",
        confidence: 0,
        root: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${screenId}`,
        },
      },
      designTokens: undefined,
      diagnostics: [
        {
          level: "warn",
          code: "UNRESOLVED_COMPONENT",
          message: `화면 Composable '${screenId}'를 심볼 테이블에서 찾을 수 없음`,
        },
      ],
    };
    return parseIRDocument(doc);
  }

  // 3. ThemeResolver
  const themeResult = await resolveTheme(projectPath);
  for (const d of themeResult.diagnostics) {
    diagnostics.push(d);
  }

  // 4. 리소스 로드
  const resources = await loadResources(projectPath);

  // 5. Composable 함수 본문 추출
  const parsedFile = symbolTable.fileByComposable.get(screenId);
  if (!parsedFile) {
    return buildFallbackDocument(screenId, discovery, diagnostics, themeResult.colors);
  }

  const funcBody = extractFunctionBody(parsedFile.source, screenId);
  if (!funcBody) {
    diagnostics.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `'${screenId}' Composable 함수 본문을 추출할 수 없음`,
    });
    return buildFallbackDocument(screenId, discovery, diagnostics, themeResult.colors);
  }

  // 6. widgetMapper로 IR 변환
  const mapCtx: MapContext = {
    depth: 0,
    maxDepth: maxInlineDepth,
    visited: new Set([screenId]),
    symbolTable,
    projectPath,
    themeColors: themeResult.colors,
    mock,
    diagnostics,
    resources,
    currentFile: composableInfo.file,
    argBindings: {},
  };

  let rootNode: IRNode;
  try {
    // 함수 전체를 Composable 호출 텍스트로 전달
    // funcBody: "fun ScreenName(...) { ... }" 전체
    // 내부 본문만 추출
    const innerBody = funcBody.slice(1, -1); // { ... } → ...

    // 최상위 Composable 노드 추출 (Scaffold, Column 등)
    const nodes = await parseTopLevelComposables(innerBody, mapCtx);

    if (nodes.length === 0) {
      rootNode = {
        type: "Unknown",
        confidence: NODE_CONFIDENCE.unknown,
        role: `component:${screenId}`,
      };
    } else if (nodes.length === 1) {
      rootNode = nodes[0]!;
    } else {
      rootNode = {
        type: "Column",
        layout: { direction: "column" },
        confidence: NODE_CONFIDENCE.standard,
        children: nodes,
      };
    }
  } catch (err) {
    diagnostics.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `IR 변환 중 오류: ${err instanceof Error ? err.message : String(err)}`,
    });
    rootNode = {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${screenId}`,
    };
  }

  // 7. confidence 집계
  const confidence = aggregateScreenConfidence(rootNode, discovery);

  // 8. IRDocument 조립
  const rawDoc = {
    schemaVersion: "0.1",
    screen: {
      id: screenId,
      sourceRef: {
        file: composableInfo.file,
        line: composableInfo.line,
        symbol: screenId,
      },
      device: "pixel-8" as const,
      discovery,
      confidence,
      root: rootNode,
    },
    designTokens: {
      colors: themeResult.colors,
    },
    diagnostics: diagnostics.map((d) => ({
      level: d.level as "info" | "warn" | "error",
      code: d.code,
      message: d.message,
    })),
  };

  return parseIRDocument(rawDoc);
  } finally {
    symbolTable.dispose();
  }
}

// ── 최상위 Composable 추출 ────────────────────────────────────────────────────

/**
 * Composable 함수 본문에서 최상위 Composable 호출들을 추출한다.
 * Scaffold, Column, Box 등 루트 위젯을 찾는다.
 */
async function parseTopLevelComposables(
  innerBody: string,
  ctx: MapContext
): Promise<IRNode[]> {
  const { mapComposable: mapper } = await import("./widgetMapper.js");

  const results: IRNode[] = [];
  const lines = innerBody.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();

    // 빈 줄, 주석, 변수 선언 건너뜀
    if (
      !line ||
      line.startsWith("//") ||
      line.startsWith("val ") ||
      line.startsWith("var ") ||
      line.startsWith("remember") ||
      line.startsWith("val ") ||
      line.startsWith("enableEdgeToEdge")
    ) {
      i++;
      continue;
    }

    // 대문자로 시작하는 Composable 호출
    if (/^[A-Z]/.test(line)) {
      // 멀티라인 Composable 호출 수집
      const callLines: string[] = [];
      let braceDepth = 0;
      let parenDepth = 0;

      let j = i;
      while (j < lines.length) {
        const l = lines[j]!;
        callLines.push(l);

        for (const ch of l) {
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          else if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
        }

        j++;
        if (parenDepth <= 0 && braceDepth <= 0 && j > i) break;
      }

      const callText = callLines.join("\n");
      const node = await mapper(callText, ctx);
      if (node) results.push(node);
      i = j;
      continue;
    }

    // when/if 블록
    if (line.startsWith("when ") || line.startsWith("when(")) {
      // when 블록 전체 수집
      const callLines: string[] = [];
      let braceDepth = 0;
      let j = i;
      while (j < lines.length) {
        const l = lines[j]!;
        callLines.push(l);
        for (const ch of l) {
          if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
        }
        j++;
        if (braceDepth <= 0 && j > i) break;
      }
      const node = await mapper("when " + callLines.join("\n"), ctx);
      if (node) results.push(node);
      i = j;
      continue;
    }

    i++;
  }

  return results;
}

// ── 폴백 문서 ─────────────────────────────────────────────────────────────────

function buildFallbackDocument(
  screenId: string,
  discovery: "route" | "candidate",
  diagnostics: Array<{ level: string; code: string; message: string }>,
  colors: Record<string, string>
): IRDocument {
  const root: IRNode = {
    type: "Unknown",
    confidence: NODE_CONFIDENCE.unknown,
    role: `component:${screenId}`,
  };

  const doc = {
    schemaVersion: "0.1",
    screen: {
      id: screenId,
      discovery,
      confidence: aggregateScreenConfidence(root, discovery),
      root,
    },
    designTokens: { colors },
    diagnostics: diagnostics.map((d) => ({
      level: d.level as "info" | "warn" | "error",
      code: d.code,
      message: d.message,
    })),
  };

  return parseIRDocument(doc);
}
