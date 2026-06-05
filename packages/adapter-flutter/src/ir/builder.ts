/**
 * builder — buildScreenIR(ctx, screenId) 구현
 *
 * 파이프라인:
 * 1. 심볼 테이블 구축
 * 2. 화면 발견 (route/candidate 판단)
 * 3. ThemeResolver로 designTokens 추출
 * 4. 화면 위젯 클래스의 build() 메서드 AST 추출
 * 5. widgetMapper로 IR 변환 (inliner 포함)
 * 6. aggregateScreenConfidence로 confidence 집계
 * 7. IRDocument 조립 + zod 스키마 검증
 */

import type { AdapterContext } from "@karax/adapter-api";
import type { IRDocument, IRNode } from "@karax/core";
import { createMockProvider, aggregateScreenConfidence, parseIRDocument, NODE_CONFIDENCE } from "@karax/core";
import { buildSymbolTable } from "../parse/scanner.js";
import { readPackageName } from "../parse/pubspec.js";
import { discoverRouteGraph } from "../discover/routeGraph.js";
import { findHeuristicCandidates } from "../discover/heuristic.js";
import { resolveTheme } from "./themeResolver.js";
import { mapWidget } from "./widgetMapper.js";
import type { MapContext } from "./widgetMapper.js";
import { findAllNodes, findChild } from "./astUtils.js";

import type { SyntaxNode } from "@karax/adapter-api";

// ── 화면 build() 위젯 노드 추출 ──────────────────────────────────────────────

function extractBuildReturnNode(classNode: SyntaxNode): SyntaxNode | undefined {
  // class_body 안에서 method_signature + function_body 패턴으로 build 메서드 찾기
  const classBody = findChild(classNode, "class_body");
  const searchIn = classBody ?? classNode;

  const children = searchIn.children.filter(c => c !== null);
  let buildBody: SyntaxNode | undefined;

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.type === "method_signature") {
      const funcSigs = findAllNodes(child, "function_signature");
      const isBuild = funcSigs.some(fs =>
        findAllNodes(fs, "identifier").some(n => n.text === "build")
      );
      if (isBuild) {
        const next = children[i + 1];
        if (next && next.type === "function_body") {
          buildBody = next;
          break;
        }
      }
    }
    // method_declaration 패턴
    if (child.type === "method_declaration") {
      const ids = findAllNodes(child, "identifier");
      if (ids.some(n => n.text === "build")) {
        buildBody = child;
        break;
      }
    }
  }

  // fallback: function_signature 직접 탐색
  if (!buildBody) {
    const funcSigs = findAllNodes(searchIn, "function_signature");
    for (const sig of funcSigs) {
      if (findAllNodes(sig, "identifier").some(n => n.text === "build")) {
        const parent = sig.parent;
        if (parent) {
          buildBody = parent;
          break;
        }
      }
    }
  }

  if (!buildBody) return undefined;

  const returnStmts = findAllNodes(buildBody, "return_statement");
  if (returnStmts.length === 0) return undefined;

  const ret = returnStmts[0]!;
  for (const child of ret.children) {
    if (!child || child.type === "return" || child.type === ";") continue;
    return child;
  }

  return undefined;
}

// ── StatefulWidget State 클래스 해석 ─────────────────────────────────────────

/**
 * StatefulWidget 클래스에서 createState()가 반환하는 State 클래스명을 추출한다.
 * 예: `=> _ListScreenState();` → `"_ListScreenState"`
 */
function extractStateClassName(classNode: SyntaxNode): string | undefined {
  const classBody = findChild(classNode, "class_body");
  if (!classBody) return undefined;

  const children = classBody.children.filter(c => c !== null);
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.type === "method_signature" && child.text.includes("createState")) {
      const next = children[i + 1];
      if (next && next.type === "function_body") {
        const match = next.text.match(/=>\s*(_?\w+)\s*\(/);
        if (match) return match[1];
      }
    }
  }
  return undefined;
}

/**
 * 파일 AST에서 주어진 이름의 클래스 노드를 찾는다.
 */
function findClassNode(fileRoot: SyntaxNode, className: string): SyntaxNode | undefined {
  const classDefs = findAllNodes(fileRoot, "class_definition");
  return classDefs.find(c => {
    const id = findChild(c, "identifier");
    return id?.text === className;
  });
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
  let packageName = "";
  try {
    packageName = await readPackageName(projectPath);
  } catch { /* 패키지명 없어도 진행 */ }

  const symbolTable = await buildSymbolTable(projectPath, packageName);

  // 2. 화면 발견 — discovery 판단
  const { routes } = await discoverRouteGraph(projectPath, symbolTable);
  const routeClassSet = new Set(routes.map(r => r.className));
  const candidates = findHeuristicCandidates(symbolTable, routeClassSet);
  const candidateClassSet = new Set(candidates.map(c => c.className));

  const isRoute = routeClassSet.has(screenId);
  const isCandidate = candidateClassSet.has(screenId);
  const discovery: "route" | "candidate" = isRoute ? "route" : "candidate";

  // 화면 클래스 존재 확인
  const classInfo = symbolTable.classes.get(screenId);
  if (!classInfo) {
    // UNRESOLVED_COMPONENT: 존재하지 않는 screenId
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
        message: `화면 클래스 '${screenId}'를 심볼 테이블에서 찾을 수 없음`,
      }],
    };
    return parseIRDocument(doc);
  }

  // 3. ThemeResolver
  const themeResult = await resolveTheme(projectPath);
  for (const d of themeResult.diagnostics) {
    diagnostics.push(d);
  }

  // 4. 화면 클래스 AST에서 build() return 노드 추출
  const parsedFile = symbolTable.fileByClass.get(screenId);
  if (!parsedFile) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  const classDefs = findAllNodes(parsedFile.root, "class_definition");
  const classNode = classDefs.find(c => {
    const id = findChild(c, "identifier");
    return id?.text === screenId;
  });

  if (!classNode) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  let returnNode = extractBuildReturnNode(classNode);

  // StatefulWidget 처리: build()가 없으면 createState() → State 클래스에서 build() 찾기
  if (!returnNode) {
    const stateClassName = extractStateClassName(classNode);
    if (stateClassName) {
      const stateClassNode = findClassNode(parsedFile.root, stateClassName);
      if (stateClassNode) {
        returnNode = extractBuildReturnNode(stateClassNode);
      }
    }
  }

  if (!returnNode) {
    return buildFallbackDocument(screenId, discovery, diagnostics);
  }

  // 5. widgetMapper로 IR 변환
  const mapCtx: MapContext = {
    depth: 0,
    maxDepth: maxInlineDepth,
    visited: new Set([screenId]),
    symbolTable,
    projectPath,
    themeTokens: themeResult.colors,
    mockProvider: mock,
    diagnostics,
    currentFileRoot: parsedFile.root,
    currentFile: parsedFile.filePath,
  };

  let rootNode: IRNode;
  try {
    const mapped = await mapWidget(returnNode, mock, mapCtx);
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

  // 6. confidence 집계
  const confidence = aggregateScreenConfidence(rootNode, discovery);

  // 7. IRDocument 조립
  const rawDoc = {
    schemaVersion: "0.1",
    screen: {
      id: screenId,
      sourceRef: {
        file: classInfo.file,
        line: classInfo.line,
        symbol: screenId,
      },
      device: "iphone-15",
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
