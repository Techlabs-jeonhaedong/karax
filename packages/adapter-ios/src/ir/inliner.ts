/**
 * inliner — 커스텀 SwiftUI View struct를 body 본문으로 인라이닝한다.
 *
 * - maxInlineDepth 기본 6, visited 집합으로 재귀 차단
 * - 생성자 인자: 리터럴은 argBindings에 바인딩
 * - 인라인 노드 confidence = 0.7 (inlined)
 * - 해석 실패 시 Unknown 노드 + UNRESOLVED_COMPONENT diagnostic
 */

import type { SyntaxNode } from "@karax/adapter-api";
import type { IRNode } from "@karax/core";
import { NODE_CONFIDENCE } from "@karax/core";
import type { SwiftSymbolTable, ParsedFile } from "../parse/scanner.js";
import { findAllNodes, findChild } from "../parse/scanner.js";
import { mapView } from "./viewMapper.js";
import type { MapContext } from "./viewMapper.js";

// ── body computed property 추출 ───────────────────────────────────────────────

/**
 * struct 정의에서 `var body: some View { ... }` 의 computed_property를 찾아
 * statements 노드를 반환한다.
 */
function extractBodyStatements(classNode: SyntaxNode): SyntaxNode | undefined {
  // class_body > property_declaration(var body) > computed_property > statements
  const classBody = findChild(classNode, "class_body");
  if (!classBody) return undefined;

  const propDecls = findAllNodes(classBody, "property_declaration");
  for (const propDecl of propDecls) {
    // pattern = "body"
    const pattern = findChild(propDecl, "pattern");
    const simpleId = pattern ? findChild(pattern, "simple_identifier") : undefined;
    if (simpleId?.text !== "body") continue;

    // computed_property > statements
    const computedProp = findChild(propDecl, "computed_property");
    if (!computedProp) continue;

    return findChild(computedProp, "statements");
  }

  return undefined;
}

/**
 * statements에서 첫 번째 call_expression 또는 navigation_expression을 반환한다.
 */
function extractFirstViewNode(stmtsNode: SyntaxNode): SyntaxNode | undefined {
  for (const child of stmtsNode.children) {
    if (!child) continue;
    if (child.type === "call_expression" || child.type === "navigation_expression") {
      return child;
    }
    if (child.type === "switch_statement" || child.type === "if_statement") {
      return child;
    }
  }
  return undefined;
}

// ── confidence 하향 조정 ───────────────────────────────────────────────────────

function downgradeConfidence(node: IRNode, factor: number): IRNode {
  return {
    ...node,
    confidence: Math.max(0, (node.confidence ?? 0) * factor),
    children: node.children?.map(c => downgradeConfidence(c, factor)),
  };
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * mapView 컨텍스트에서 커스텀 SwiftUI View struct를 인라이닝하는 헬퍼.
 */
export async function tryInlineSwiftView(
  viewName: string,
  symbolTable: SwiftSymbolTable,
  projectPath: string,
  ctx: MapContext
): Promise<IRNode> {
  const unknownNode: IRNode = {
    type: "Unknown",
    confidence: NODE_CONFIDENCE.unknown,
    role: `component:${viewName}`,
  };

  // 심볼 테이블 조회
  const structInfo = symbolTable.structs.get(viewName);
  if (!structInfo) {
    ctx.diagnostics?.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `커스텀 View '${viewName}'를 심볼 테이블에서 찾을 수 없음`,
    });
    return unknownNode;
  }

  // 재귀 차단
  if (ctx.visited.has(viewName)) return unknownNode;

  // 깊이 제한
  if (ctx.depth >= ctx.maxDepth) return unknownNode;

  // 파일에서 class_declaration 찾기
  const parsedFile = symbolTable.fileByStruct.get(viewName);
  if (!parsedFile) return unknownNode;

  const classDefs = findAllNodes(parsedFile.root, "class_declaration");
  const classNode = classDefs.find(cls => {
    const typeId = findChild(cls, "type_identifier");
    return typeId?.text === viewName;
  });
  if (!classNode) return unknownNode;

  // body statements 추출
  const stmtsNode = extractBodyStatements(classNode);
  if (!stmtsNode) return unknownNode;

  const firstNode = extractFirstViewNode(stmtsNode);
  if (!firstNode) return unknownNode;

  // 방문 집합 갱신
  const newVisited = new Set(ctx.visited);
  newVisited.add(viewName);

  // 인라인 대상 struct의 class_body를 ctx에 전달 (computed property 참조 해석용)
  const inlineClassBody = (() => {
    const cd = classDefs.find(cls => {
      const typeId = findChild(cls, "type_identifier");
      return typeId?.text === viewName;
    });
    return cd ? findChild(cd, "class_body") : undefined;
  })();

  const inlineCtx: MapContext = {
    ...ctx,
    depth: ctx.depth + 1,
    visited: newVisited,
    currentFile: parsedFile.filePath,
    currentClassBody: inlineClassBody,
  };

  const mapped = await mapView(firstNode, inlineCtx);
  if (!mapped) return unknownNode;

  const downgraded = downgradeConfidence(mapped, NODE_CONFIDENCE.inlined);
  return { ...downgraded, confidence: NODE_CONFIDENCE.inlined };
}
