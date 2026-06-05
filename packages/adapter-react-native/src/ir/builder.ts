/**
 * builder — buildScreenIR(ctx, screenId) 구현
 *
 * 파이프라인:
 * 1. 심볼 테이블 구축
 * 2. 화면 발견 (route/candidate 판단)
 * 3. ThemeResolver로 designTokens 추출
 * 4. 화면 컴포넌트의 return JSX 추출
 * 5. componentMapper로 IR 변환 (inliner 포함)
 * 6. aggregateScreenConfidence로 confidence 집계
 * 7. IRDocument 조립 + zod 스키마 검증
 */

import type { AdapterContext } from "@karax/adapter-api";
import type { IRDocument, IRNode } from "@karax/core";
import { createMockProvider, aggregateScreenConfidence, parseIRDocument, NODE_CONFIDENCE } from "@karax/core";
import { buildSymbolTable } from "../parse/scanner.js";
import { discoverRouteGraph } from "../discover/routeGraph.js";
import { findHeuristicCandidates } from "../discover/heuristic.js";
import { resolveTheme } from "./themeResolver.js";
import { mapComponent, parseStyleSheet, type MapContext } from "./componentMapper.js";
import { findNodes, findChild } from "../parse/scanner.js";
import type { SyntaxNode } from "@karax/adapter-api";

// ── 화면 컴포넌트의 return JSX 추출 ──────────────────────────────────────────

function extractComponentReturnJsx(
  root: SyntaxNode,
  componentName: string
): SyntaxNode | undefined {
  // function_declaration
  const funcDecls = findNodes(root, "function_declaration");
  for (const decl of funcDecls) {
    const nameId = findChild(decl, "identifier");
    if (nameId?.text !== componentName) continue;
    const body = findChild(decl, "statement_block");
    if (!body) continue;
    return extractFirstReturn(body);
  }

  // export_statement → function_declaration
  const exportStmts = findNodes(root, "export_statement");
  for (const exp of exportStmts) {
    const funcDecl = findChild(exp, "function_declaration");
    if (!funcDecl) continue;
    const nameId = findChild(funcDecl, "identifier");
    if (nameId?.text !== componentName) continue;
    const body = findChild(funcDecl, "statement_block");
    if (!body) continue;
    return extractFirstReturn(body);
  }

  // lexical_declaration: const Foo = () => <JSX />
  const lexDecls = findNodes(root, "lexical_declaration");
  for (const decl of lexDecls) {
    const varDecl = findChild(decl, "variable_declarator");
    if (!varDecl) continue;
    const nameId = findChild(varDecl, "identifier");
    if (nameId?.text !== componentName) continue;

    const arrowFunc = findNodes(varDecl, "arrow_function")[0];
    if (!arrowFunc) continue;

    const children = arrowFunc.children.filter((c): c is SyntaxNode => c !== null);
    const arrowIdx = children.findIndex(c => c.type === "=>");
    if (arrowIdx < 0) continue;

    const body = children[arrowIdx + 1];
    if (!body) continue;

    if (body.type === "jsx_element" || body.type === "jsx_self_closing_element") return body;
    if (body.type === "parenthesized_expression") {
      const inner = body.children.find(
        (c): c is SyntaxNode => c !== null && (c.type === "jsx_element" || c.type === "jsx_self_closing_element")
      );
      if (inner) return inner;
    }
    if (body.type === "statement_block") {
      return extractFirstReturn(body);
    }
  }

  return undefined;
}

function extractFirstReturn(stmtBlock: SyntaxNode): SyntaxNode | undefined {
  const retStmts = findNodes(stmtBlock, "return_statement");
  if (retStmts.length === 0) return undefined;

  const ret = retStmts[0]!;
  for (const c of ret.children) {
    if (!c || c.type === "return" || c.type === ";") continue;
    if (c.type === "parenthesized_expression") {
      const inner = c.children.find(
        (ch): ch is SyntaxNode => ch !== null && ch.type !== "(" && ch.type !== ")"
      );
      return inner;
    }
    return c;
  }
  return undefined;
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

// ── 공개 API ─────────────────────────────────────────────────────────────────

export async function buildScreenIR(
  ctx: AdapterContext,
  screenId: string
): Promise<IRDocument> {
  const { projectPath, mockSeed = 42, maxInlineDepth = 6 } = ctx;
  const mock = createMockProvider(mockSeed);
  const diagnostics: Array<{ level: string; code: string; message: string }> = [];

  // 1. 심볼 테이블 구축
  const symbolTable = await buildSymbolTable(projectPath);

  // 2. 화면 발견 — discovery 판단
  const { routes } = await discoverRouteGraph(projectPath, symbolTable);
  const routeComponentNames = new Set(routes.map(r => r.componentName));
  const candidates = findHeuristicCandidates(symbolTable, routeComponentNames);
  const candidateComponentNames = new Set(candidates.map(c => c.componentName));

  const isRoute = routeComponentNames.has(screenId);
  const discovery: "route" | "candidate" = isRoute ? "route" : "candidate";

  // 화면 컴포넌트 존재 확인
  const componentInfo = symbolTable.components.get(screenId);
  if (!componentInfo) {
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
        message: `화면 컴포넌트 '${screenId}'를 심볼 테이블에서 찾을 수 없음`,
      }],
    };
    return parseIRDocument(doc);
  }

  // 3. ThemeResolver
  const themeResult = await resolveTheme(projectPath);
  for (const d of themeResult.diagnostics) {
    diagnostics.push(d);
  }

  // 4. 화면 컴포넌트 파일에서 return JSX 추출
  const parsedFile = symbolTable.fileByComponent.get(screenId);
  if (!parsedFile) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  const returnNode = extractComponentReturnJsx(parsedFile.root, screenId);
  if (!returnNode) {
    diagnostics.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `컴포넌트 '${screenId}'의 JSX return을 파싱할 수 없음`,
    });
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  // 5. componentMapper로 IR 변환
  const fileStyleSheet = parseStyleSheet(parsedFile.root);

  const mapCtx: MapContext = {
    depth: 0,
    maxDepth: maxInlineDepth,
    visited: new Set([screenId]),
    symbolTable,
    projectPath,
    themeColors: themeResult.colors,
    styleSheet: fileStyleSheet,
    mockProvider: mock,
    diagnostics,
    currentFile: parsedFile.filePath,
  };

  let rootNode: IRNode;
  try {
    const mapped = await mapComponent(returnNode, mock, mapCtx);
    rootNode = mapped ?? {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${screenId}`,
    };
  } catch (e) {
    diagnostics.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `IR 변환 실패: ${e instanceof Error ? e.message : String(e)}`,
    });
    rootNode = {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${screenId}`,
    };
  }

  // 6. confidence 집계
  const confidence = aggregateScreenConfidence(rootNode, discovery);

  // 7. IRDocument 조립
  const designTokens: {
    colors?: Record<string, string>;
    spacing?: Record<string, number>;
    typography?: Record<string, unknown>;
  } = {};
  if (Object.keys(themeResult.colors).length > 0) designTokens.colors = themeResult.colors;
  if (Object.keys(themeResult.spacing).length > 0) designTokens.spacing = themeResult.spacing;
  if (Object.keys(themeResult.typography).length > 0) designTokens.typography = themeResult.typography;

  const rawDoc = {
    schemaVersion: "0.1",
    screen: {
      id: screenId,
      sourceRef: {
        file: componentInfo.file,
        line: componentInfo.line,
        symbol: screenId,
      },
      device: "pixel-8",
      discovery,
      confidence,
      root: rootNode,
    },
    designTokens: Object.keys(designTokens).length > 0 ? designTokens : undefined,
    diagnostics: diagnostics.map(d => ({
      level: d.level as "info" | "warn" | "error",
      code: d.code,
      message: d.message,
    })),
  };

  return parseIRDocument(rawDoc);
}
