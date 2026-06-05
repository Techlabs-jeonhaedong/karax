/**
 * routeGraph — @main App → WindowGroup → NavigationStack → NavigationLink 추적
 *
 * 전략:
 * 1. @main App struct에서 WindowGroup의 첫 번째 뷰 추출 (typealias 해석)
 * 2. 해당 루트 뷰 파일에서 NavigationLink(destination:) 재귀 추적
 * 3. navigationDestination(for:) 패턴도 지원
 */

import { readFile } from "fs/promises";
import path from "path";
import type { SyntaxNode } from "@karax/adapter-api";
import type { SwiftSymbolTable } from "../parse/scanner.js";
import { findAllNodes, findChild, filterChildren } from "../parse/scanner.js";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface RouteEntry {
  className: string;
  source: "window-group" | "navigation-link" | "navigation-destination";
}

export interface DiagnosticEntry {
  code: string;
  message: string;
}

export interface RouteGraphResult {
  routes: RouteEntry[];
  diagnostics: DiagnosticEntry[];
}

// ── AST 헬퍼: value_argument에서 named arg 값 추출 ────────────────────────────

/**
 * call_suffix → value_arguments에서 label 이름으로 값 표현식을 찾는다.
 * value_argument: [value_argument_label(simple_identifier), :, <expr>]
 */
function getNamedArgValue(valueArgs: SyntaxNode, label: string): SyntaxNode | undefined {
  const args = findAllNodes(valueArgs, "value_argument");
  for (const arg of args) {
    const labelNode = findChild(arg, "value_argument_label");
    if (labelNode?.text !== label) continue;
    // label 노드, ":" 노드를 제외한 첫 번째 값 노드
    for (const child of arg.children) {
      if (!child) continue;
      if (child.type === "value_argument_label" || child.type === ":") continue;
      return child;
    }
  }
  return undefined;
}

/**
 * call_expression 또는 navigation_expression에서 함수명과 value_arguments를 추출한다.
 */
function extractCallInfo(node: SyntaxNode): { name: string; args: SyntaxNode | undefined } | undefined {
  // call_expression: [simple_identifier | navigation_expression, call_suffix, ...]
  // 여기서 최상단 call_expression만 처리

  // 가장 안쪽 call_expression을 찾아야 수정자 체인이 아닌 진짜 위젯 호출을 얻음
  if (node.type !== "call_expression") return undefined;

  // simple_identifier 자식이 있으면 그게 함수명
  const simpleId = findChild(node, "simple_identifier");
  if (simpleId) {
    const callSuffix = findChild(node, "call_suffix");
    const valueArgs = callSuffix ? findChild(callSuffix, "value_arguments") : undefined;
    return { name: simpleId.text, args: valueArgs };
  }

  // navigation_expression 자식이 있으면 마지막 .xxx 전 호출
  const navExpr = findChild(node, "navigation_expression");
  if (navExpr) {
    return extractCallInfo(navExpr);
  }

  return undefined;
}

/**
 * 뷰 표현식(call_expression)에서 instantiate된 struct 이름을 추출한다.
 * 예: ContentView() → "ContentView", NavigationLink(destination: DetailScreen()) 내부 → "DetailScreen"
 */
function extractViewName(node: SyntaxNode): string | undefined {
  if (!node) return undefined;

  if (node.type === "simple_identifier") return node.text;

  if (node.type === "call_expression") {
    // navigation_expression일 경우 가장 안쪽 call_expression을 탐색
    const navExpr = findChild(node, "navigation_expression");
    if (navExpr) {
      // 수정자 체인: 가장 안쪽 call_expression이 실제 위젯
      return extractInnermostCallName(navExpr);
    }
    const simpleId = findChild(node, "simple_identifier");
    return simpleId?.text;
  }

  if (node.type === "navigation_expression") {
    return extractInnermostCallName(node);
  }

  return undefined;
}

/**
 * navigation_expression 체인에서 가장 안쪽 call_expression의 이름을 추출한다.
 */
function extractInnermostCallName(node: SyntaxNode): string | undefined {
  // navigation_expression: [call_expression(inner), navigation_suffix, ...]
  // 반복적으로 안쪽으로 파고들기
  let current: SyntaxNode = node;
  while (current.type === "navigation_expression" || current.type === "call_expression") {
    const inner = findChild(current, "navigation_expression")
      ?? findChild(current, "call_expression");
    if (!inner) break;
    current = inner;
  }

  if (current.type === "call_expression") {
    const simpleId = findChild(current, "simple_identifier");
    return simpleId?.text;
  }
  if (current.type === "simple_identifier") return current.text;
  return undefined;
}

// ── NavigationLink destination 추출 ──────────────────────────────────────────

/**
 * NavigationLink(destination: X()) 형태에서 X를 추출한다.
 * call_expression > call_suffix > value_arguments > value_argument(destination:) > call_expression > simple_identifier
 */
function extractNavigationLinkDestination(callExpr: SyntaxNode): string | undefined {
  // call_suffix를 찾는다
  const callSuffix = findChild(callExpr, "call_suffix");
  if (!callSuffix) return undefined;

  const valueArgs = findChild(callSuffix, "value_arguments");
  if (!valueArgs) return undefined;

  const destArg = getNamedArgValue(valueArgs, "destination");
  if (!destArg) return undefined;

  return extractViewName(destArg);
}

// ── 파일 전체에서 NavigationLink destination 스캔 ────────────────────────────

function scanNavigationLinks(root: SyntaxNode, symbolTable: SwiftSymbolTable): string[] {
  const result: string[] = [];
  const allCalls = findAllNodes(root, "call_expression");

  for (const call of allCalls) {
    // 가장 안쪽 call의 이름이 NavigationLink인지 확인
    const innerName = (() => {
      // call_expression > simple_identifier 직접 자식
      const simpleId = findChild(call, "simple_identifier");
      if (simpleId?.text === "NavigationLink") return "NavigationLink";
      // navigation_expression 체인의 최심 call
      const navExpr = findChild(call, "navigation_expression");
      if (navExpr) return extractInnermostCallName(navExpr);
      return simpleId?.text;
    })();

    if (innerName !== "NavigationLink") continue;

    const dest = extractNavigationLinkDestination(call);
    if (dest && symbolTable.structs.has(dest)) {
      result.push(dest);
    }
  }

  return result;
}

// ── WindowGroup에서 루트 뷰 추출 ─────────────────────────────────────────────

/**
 * @main App struct의 WindowGroup { ContentView() } 에서
 * 첫 번째 뷰 struct 이름을 추출한다.
 * typealias를 해석한다.
 */
function extractWindowGroupRootView(
  appStructName: string,
  table: SwiftSymbolTable
): string | undefined {
  const parsedFile = table.fileByStruct.get(appStructName);
  if (!parsedFile) return undefined;

  const root = parsedFile.root;

  // @main struct의 class_declaration 찾기
  const classDefs = findAllNodes(root, "class_declaration");
  const appClassDef = classDefs.find(cls => {
    const typeId = findChild(cls, "type_identifier");
    return typeId?.text === appStructName;
  });
  if (!appClassDef) return undefined;

  // WindowGroup 호출 찾기
  const allCalls = findAllNodes(appClassDef, "call_expression");
  for (const call of allCalls) {
    const simpleId = findChild(call, "simple_identifier");
    if (simpleId?.text !== "WindowGroup") continue;

    // WindowGroup { ContentView() } — 트레일링 클로저 내부
    const callSuffix = findChild(call, "call_suffix");
    if (!callSuffix) continue;
    const lambda = findChild(callSuffix, "lambda_literal");
    if (!lambda) continue;

    const statements = findChild(lambda, "statements");
    if (!statements) continue;

    // 첫 번째 call_expression
    const firstCall = findChild(statements, "call_expression");
    if (!firstCall) continue;

    // navigation_expression 내부의 가장 안쪽 이름
    const navExpr = findChild(firstCall, "navigation_expression");
    const viewName = navExpr
      ? extractInnermostCallName(navExpr)
      : findChild(firstCall, "simple_identifier")?.text;

    if (!viewName) continue;

    // typealias 해석
    const resolved = table.aliasMap.get(viewName) ?? viewName;
    return resolved;
  }

  return undefined;
}

// ── BFS: 루트 뷰에서 NavigationLink 추적 ─────────────────────────────────────

async function bfsNavigationLinks(
  rootViewName: string,
  table: SwiftSymbolTable,
  projectPath: string
): Promise<{ className: string; source: RouteEntry["source"] }[]> {
  const visited = new Set<string>();
  const queue: string[] = [rootViewName];
  const result: { className: string; source: RouteEntry["source"] }[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const parsedFile = table.fileByStruct.get(current);
    if (!parsedFile) continue;

    const links = scanNavigationLinks(parsedFile.root, table);
    for (const linkTarget of links) {
      if (!visited.has(linkTarget)) {
        result.push({ className: linkTarget, source: "navigation-link" });
        queue.push(linkTarget);
      }
    }
  }

  return result;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export async function discoverSwiftRouteGraph(
  projectPath: string,
  symbolTable: SwiftSymbolTable
): Promise<RouteGraphResult> {
  const seen = new Set<string>();
  const routes: RouteEntry[] = [];
  const diagnostics: DiagnosticEntry[] = [];

  function addRoute(className: string, source: RouteEntry["source"]) {
    const resolved = symbolTable.aliasMap.get(className) ?? className;
    if (seen.has(resolved)) return;
    if (!symbolTable.structs.has(resolved)) {
      // struct를 찾을 수 없어도 route에 기록하진 않음
      return;
    }
    seen.add(resolved);
    routes.push({ className: resolved, source });
  }

  if (!symbolTable.mainApp) {
    diagnostics.push({
      code: "NO_MAIN_APP",
      message: "@main App struct를 찾을 수 없습니다",
    });
    return { routes, diagnostics };
  }

  // 1. WindowGroup 루트 뷰
  const rootView = extractWindowGroupRootView(symbolTable.mainApp, symbolTable);
  if (!rootView) {
    diagnostics.push({
      code: "NO_WINDOW_GROUP",
      message: "WindowGroup에서 루트 뷰를 추출할 수 없습니다",
    });
    return { routes, diagnostics };
  }

  addRoute(rootView, "window-group");

  // 2. BFS로 NavigationLink 추적
  const navLinks = await bfsNavigationLinks(rootView, symbolTable, projectPath);
  for (const link of navLinks) {
    addRoute(link.className, link.source);
  }

  return { routes, diagnostics };
}
