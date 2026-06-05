/**
 * builder — buildSwiftScreenIR(ctx, screenId) 구현
 *
 * 파이프라인:
 * 1. 심볼 테이블 구축
 * 2. 화면 발견 (route/candidate 판단)
 * 3. ThemeResolver로 designTokens 추출
 * 4. 화면 struct의 body computed property에서 statements 추출
 * 5. viewMapper로 IR 변환 (inliner 포함)
 * 6. aggregateScreenConfidence로 confidence 집계
 * 7. IRDocument 조립 + zod 스키마 검증
 */

import type { AdapterContext } from "@karax/adapter-api";
import type { IRDocument, IRNode } from "@karax/core";
import { createMockProvider, aggregateScreenConfidence, parseIRDocument, NODE_CONFIDENCE } from "@karax/core";
import { buildSwiftSymbolTable } from "../parse/scanner.js";
import { findAllNodes, findChild } from "../parse/scanner.js";
import { discoverSwiftRouteGraph } from "../discover/routeGraph.js";
import { findSwiftHeuristicCandidates } from "../discover/heuristic.js";
import { resolveSwiftTheme } from "./themeResolver.js";
import { mapView } from "./viewMapper.js";
import type { MapContext } from "./viewMapper.js";

// ── body statements 추출 ──────────────────────────────────────────────────────

function extractBodyStatementsNode(classNode: any): any {
  const classBody = findChild(classNode, "class_body");
  if (!classBody) return undefined;

  const propDecls = findAllNodes(classBody, "property_declaration");
  for (const propDecl of propDecls) {
    const pattern = findChild(propDecl, "pattern");
    const simpleId = pattern ? findChild(pattern, "simple_identifier") : undefined;
    if (simpleId?.text !== "body") continue;

    const computedProp = findChild(propDecl, "computed_property");
    if (!computedProp) continue;

    return findChild(computedProp, "statements");
  }

  return undefined;
}

function extractFirstViewNode(stmtsNode: any): any {
  for (const child of stmtsNode.children) {
    if (!child) continue;
    if (
      child.type === "call_expression" ||
      child.type === "navigation_expression" ||
      child.type === "switch_statement" ||
      child.type === "if_statement"
    ) {
      return child;
    }
  }
  return undefined;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export async function buildSwiftScreenIR(
  ctx: AdapterContext,
  screenId: string
): Promise<IRDocument> {
  const { projectPath, mockSeed = 42, maxInlineDepth = 6 } = ctx;
  const mock = createMockProvider(mockSeed);
  const diagnostics: Array<{ level: string; code: string; message: string }> = [];

  // 1. 심볼 테이블 구축
  const symbolTable = await buildSwiftSymbolTable(projectPath);

  // 2. 화면 발견
  const { routes } = await discoverSwiftRouteGraph(projectPath, symbolTable);
  const routeClassSet = new Set(routes.map(r => r.className));
  const candidates = findSwiftHeuristicCandidates(symbolTable, routeClassSet);
  const candidateClassSet = new Set(candidates.map(c => c.className));

  const isRoute = routeClassSet.has(screenId);
  const discovery: "route" | "candidate" = isRoute ? "route" : "candidate";

  // 화면 클래스 존재 확인
  const structInfo = symbolTable.structs.get(screenId);
  if (!structInfo) {
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
      diagnostics: [{
        level: "warn",
        code: "UNRESOLVED_COMPONENT",
        message: `화면 struct '${screenId}'를 심볼 테이블에서 찾을 수 없음`,
      }],
    };
    return parseIRDocument(doc);
  }

  // 3. ThemeResolver
  const themeResult = await resolveSwiftTheme(projectPath);
  for (const d of themeResult.diagnostics) {
    diagnostics.push(d);
  }

  // 4. 화면 struct AST에서 body statements 추출
  const parsedFile = symbolTable.fileByStruct.get(screenId);
  if (!parsedFile) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  const classDefs = findAllNodes(parsedFile.root, "class_declaration");
  const classNode = classDefs.find((c: any) => {
    const typeId = findChild(c, "type_identifier");
    return typeId?.text === screenId;
  });

  if (!classNode) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  const stmtsNode = extractBodyStatementsNode(classNode);
  if (!stmtsNode) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  const firstNode = extractFirstViewNode(stmtsNode);
  if (!firstNode) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  // 5. viewMapper로 IR 변환
  const classBody = findChild(classNode, "class_body");
  const mapCtx: MapContext = {
    depth: 0,
    maxDepth: maxInlineDepth,
    visited: new Set([screenId]),
    symbolTable,
    projectPath,
    designTokens: themeResult.colors,
    mockProvider: mock,
    diagnostics,
    currentFile: parsedFile.filePath,
    argBindings: {},
    currentClassBody: classBody,
  };

  let rootNode: IRNode;
  try {
    const mapped = await mapView(firstNode, mapCtx);
    rootNode = mapped ?? {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${screenId}`,
    };
  } catch {
    rootNode = {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${screenId}`,
    };
  }

  // navigationTitle 수정자를 body 전체 소스에서 찾아 appbar 추가 (이미 NavigationStack 내부에서 처리되지 않은 경우)
  // (NavigationStack이 아닌 최상단에 .navigationTitle이 붙은 경우)
  if (rootNode.type !== "Box" || !rootNode.children?.some(c => c.role === "appbar")) {
    const bodyText = stmtsNode.text ?? "";
    const navTitleMatch = bodyText.match(/\.navigationTitle\s*\(\s*["']([^"']+)["']\s*\)/);
    if (navTitleMatch && navTitleMatch[1]) {
      // appbar가 없으면 최상단 Box에 추가
      const title = navTitleMatch[1];
      if (rootNode.type === "Box") {
        rootNode = {
          ...rootNode,
          children: [
            {
              type: "Box",
              role: "appbar",
              layout: { direction: "row", crossAxis: "center" },
              confidence: NODE_CONFIDENCE.standard,
              children: [{ type: "Text", text: { value: title, token: "headline" }, confidence: NODE_CONFIDENCE.standard }],
            },
            ...(rootNode.children ?? []),
          ],
        };
      }
    }
  }

  // 6. confidence 집계
  const confidence = aggregateScreenConfidence(rootNode, discovery);

  // 7. IRDocument 조립
  const rawDoc = {
    schemaVersion: "0.1",
    screen: {
      id: screenId,
      sourceRef: {
        file: structInfo.file,
        line: structInfo.line,
        symbol: screenId,
      },
      device: "iphone-15" as const,
      discovery,
      confidence,
      root: rootNode,
    },
    designTokens: {
      colors: themeResult.colors,
    },
    diagnostics: diagnostics.map(d => ({
      level: d.level as "info" | "warn" | "error",
      code: d.code,
      message: d.message,
    })),
  };

  return parseIRDocument(rawDoc);
}

// ── 폴백 문서 ─────────────────────────────────────────────────────────────────

function buildFallbackDocument(
  screenId: string,
  discovery: "route" | "candidate",
  diagnostics: Array<{ level: string; code: string; message: string }>
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
    designTokens: undefined,
    diagnostics: diagnostics.map(d => ({
      level: d.level as "info" | "warn" | "error",
      code: d.code,
      message: d.message,
    })),
  };

  return parseIRDocument(doc);
}
