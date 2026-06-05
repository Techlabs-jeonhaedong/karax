import path from "path";
import { readFile } from "fs/promises";
import { withParsedSource, type SyntaxNode } from "@karax/adapter-api";
import { findNodes, findChild, filterChildren } from "../parse/scanner.js";
import type { SymbolTable } from "../parse/scanner.js";
import { discoverGetxRoutes } from "./getx.js";

// ── AST 유틸 ────────────────────────────────────────────────────────────────

export function findByIdentifier(node: SyntaxNode, name: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === "identifier" && node.text === name) results.push(node);
  for (const child of node.children) {
    if (child) findByIdentifier(child, name, results);
  }
  return results;
}

/** named_argument 목록에서 label명으로 값 노드를 찾는다 */
export function getNamedArg(argsNode: SyntaxNode, label: string): SyntaxNode | undefined {
  const namedArgs = findNodes(argsNode, "named_argument");
  for (const na of namedArgs) {
    const labelNode = findChild(na, "label");
    const id = labelNode ? findChild(labelNode, "identifier") : undefined;
    if (id?.text === label) {
      // label 다음 sibling이 값 노드
      return na.children.find((c): c is SyntaxNode => c !== null && c.type !== "label") ?? undefined;
    }
  }
  return undefined;
}

/**
 * function_expression_body(=> expr) 또는 block return 에서
 * 생성되는 위젯 클래스명을 추출한다.
 */
export function extractWidgetClassFromBuilder(node: SyntaxNode): string | undefined {
  const body = findNodes(node, "function_expression_body")[0];
  if (body) {
    const constObj = findNodes(body, "const_object_expression")[0];
    if (constObj) {
      return findChild(constObj, "type_identifier")?.text;
    }
    // non-const: ClassName(...)
    const firstId = body.children.find((c): c is SyntaxNode => c !== null && c.type === "identifier");
    if (firstId) return firstId.text;
  }
  // function_body (block) → return statement 탐색
  const retStmts = findNodes(node, "return_statement");
  for (const ret of retStmts) {
    const constObj = findNodes(ret, "const_object_expression")[0];
    if (constObj) {
      return findChild(constObj, "type_identifier")?.text;
    }
    const firstId = ret.children.find((c): c is SyntaxNode => c !== null && c.type === "identifier");
    if (firstId && firstId.text !== "return") return firstId.text;
  }
  return undefined;
}

// ── MaterialPageRoute builder 에서 위젯 클래스명 추출 ────────────────────────

export function extractFromMaterialPageRoute(mprArgs: SyntaxNode): string | undefined {
  const builderArg = getNamedArg(mprArgs, "builder");
  if (!builderArg) return undefined;
  return extractWidgetClassFromBuilder(builderArg);
}

// ── routes: {} 테이블 파싱 ──────────────────────────────────────────────────

function parseRoutesMap(routesValue: SyntaxNode): string[] {
  const result: string[] = [];
  const pairs = findNodes(routesValue, "pair");
  for (const pair of pairs) {
    const funcExpr = pair.children.find(
      (c): c is SyntaxNode =>
        c !== null && (c.type === "function_expression" || c.type === "const_object_expression")
    );
    if (!funcExpr) continue;

    if (funcExpr.type === "const_object_expression") {
      const name = findChild(funcExpr, "type_identifier")?.text;
      if (name) result.push(name);
    } else {
      const name = extractWidgetClassFromBuilder(funcExpr);
      if (name) result.push(name);
    }
  }
  return result;
}

// ── home: 파싱 ──────────────────────────────────────────────────────────────

function parseHomeArg(homeValue: SyntaxNode): string | undefined {
  if (homeValue.type === "const_object_expression") {
    return findChild(homeValue, "type_identifier")?.text;
  }
  if (homeValue.type === "identifier") {
    return homeValue.text;
  }
  return extractWidgetClassFromBuilder(homeValue);
}

// ── onGenerateRoute switch/if 파싱 ──────────────────────────────────────────

function extractMprClassFromNode(node: SyntaxNode): string | undefined {
  // MaterialPageRoute identifier 바로 다음 형제(nextSibling)가 해당 MPR의 selector다.
  // parent.children.find()는 공유 parent를 쓸 때 첫 번째 selector만 반환하므로 nextSibling 사용.
  const selectorNode = node.nextSibling as SyntaxNode | null;
  if (!selectorNode || selectorNode.type !== "selector") return undefined;
  const ap = findChild(selectorNode, "argument_part");
  if (!ap) return undefined;
  const args = findChild(ap, "arguments");
  if (!args) return undefined;
  return extractFromMaterialPageRoute(args);
}

function parseOnGenerateRoute(fnNode: SyntaxNode): string[] {
  const result: string[] = [];

  // switch_statement 내 case 탐색
  const switchStmts = findNodes(fnNode, "switch_statement");
  for (const sw of switchStmts) {
    const switchCases = findNodes(sw, "switch_case");
    for (const sc of switchCases) {
      const mprIds = findByIdentifier(sc, "MaterialPageRoute");
      for (const mprId of mprIds) {
        const className = extractMprClassFromNode(mprId);
        if (className) result.push(className);
      }
    }
  }

  // if/else 체인 탐색 (switch 없이 if만 쓰는 경우)
  if (result.length === 0) {
    const mprIds = findByIdentifier(fnNode, "MaterialPageRoute");
    for (const mprId of mprIds) {
      const className = extractMprClassFromNode(mprId);
      if (className && !result.includes(className)) result.push(className);
    }
  }

  return result;
}

// ── GoRouter 파싱 ────────────────────────────────────────────────────────────

function parseGoRouter(node: SyntaxNode): string[] {
  const result: string[] = [];
  const goRouteIds = findByIdentifier(node, "GoRoute");
  for (const goRouteId of goRouteIds) {
    // list_literal 안에서 GoRoute identifier 바로 다음 형제가 해당 GoRoute의 selector다.
    // parent.children.find()는 첫 번째 selector만 반환하므로 nextSibling을 사용한다.
    const selectorNode = goRouteId.nextSibling as SyntaxNode | null;
    if (!selectorNode || selectorNode.type !== "selector") continue;
    const ap = findChild(selectorNode, "argument_part");
    if (!ap) continue;
    const args = findChild(ap, "arguments");
    if (!args) continue;

    const builderArg = getNamedArg(args, "builder");
    if (!builderArg) continue;
    const className = extractWidgetClassFromBuilder(builderArg);
    if (className) result.push(className);
  }
  return result;
}

// ── Navigator.push* 전체 파일 스캔 ──────────────────────────────────────────

function scanNavigatorPush(root: SyntaxNode): string[] {
  const result: string[] = [];
  const navIds = findByIdentifier(root, "Navigator");

  for (const navId of navIds) {
    if (!navId.parent) continue;

    // Navigator 자신의 parent 노드에서 selector 체인으로 arguments 찾기
    const selectorChain = filterChildren(navId.parent, "selector");
    let argsNode: SyntaxNode | undefined;

    for (const sel of selectorChain) {
      const foundArgs = findNodes(sel, "arguments")[0];
      if (foundArgs) argsNode = foundArgs;
    }

    if (!argsNode) continue;

    // arguments 안에서 MaterialPageRoute 탐색
    const mprIds = findByIdentifier(argsNode, "MaterialPageRoute");
    for (const mprId of mprIds) {
      const className = extractMprClassFromNode(mprId);
      if (className) result.push(className);
    }
  }
  return result;
}

// ── main.dart 에서 MaterialApp/CupertinoApp 파라미터 추출 ────────────────────

interface MaterialAppArgs {
  routeClasses: string[];
  homeClass?: string;
  onGenerateRouteClasses: string[];
  goRouterClasses: string[];
}

async function extractFromMainDart(projectPath: string): Promise<MaterialAppArgs> {
  const mainPath = path.join(projectPath, "lib", "main.dart");
  let source: string;
  try {
    source = await readFile(mainPath, "utf-8");
  } catch {
    return { routeClasses: [], onGenerateRouteClasses: [], goRouterClasses: [] };
  }

  return withParsedSource("dart", source, (root) => {
    const result: MaterialAppArgs = {
      routeClasses: [],
      onGenerateRouteClasses: [],
      goRouterClasses: [],
    };

    // GoRouter가 있는지 먼저 확인
    const goRouterIds = findByIdentifier(root, "GoRouter");
    for (const goRouterId of goRouterIds) {
      // GoRouter identifier 바로 다음 형제(nextSibling)가 해당 GoRouter의 selector다.
      const selectorNode = goRouterId.nextSibling as SyntaxNode | null;
      if (!selectorNode || selectorNode.type !== "selector") continue;
      const ap = findChild(selectorNode, "argument_part");
      if (!ap) continue;
      const args = findChild(ap, "arguments");
      if (!args) continue;
      const classes = parseGoRouter(args);
      result.goRouterClasses.push(...classes);
    }

    // MaterialApp / CupertinoApp arguments 탐색
    for (const appName of ["MaterialApp", "CupertinoApp"]) {
      const appIds = findByIdentifier(root, appName);
      for (const appId of appIds) {
        if (!appId.parent) continue;

        // MaterialApp.router 형태 건너뜀
        const nextSel = appId.parent.children.find(
          (c): c is SyntaxNode => c !== null && c.type === "selector"
        );
        const assgnSel = nextSel ? findChild(nextSel, "unconditional_assignable_selector") : undefined;
        if (assgnSel?.text === ".router") continue;

        // arguments 노드 찾기
        let args: SyntaxNode | undefined;
        const selectors = filterChildren(appId.parent, "selector");
        for (const sel of selectors) {
          const ap = findChild(sel, "argument_part");
          if (ap) {
            args = findChild(ap, "arguments");
            break;
          }
        }
        if (!args) continue;

        // routes:
        const routesArg = getNamedArg(args, "routes");
        if (routesArg) {
          result.routeClasses.push(...parseRoutesMap(routesArg));
        }

        // home:
        const homeArg = getNamedArg(args, "home");
        if (homeArg && !result.homeClass) {
          result.homeClass = parseHomeArg(homeArg);
        }

        // onGenerateRoute:
        const onGenArg = getNamedArg(args, "onGenerateRoute");
        if (onGenArg) {
          result.onGenerateRouteClasses.push(...parseOnGenerateRoute(onGenArg));
        }
      }
    }

    return result;
  });
}

// ── 결과 타입 ────────────────────────────────────────────────────────────────

export interface RouteEntry {
  className: string;
  source: "routes-table" | "home" | "on-generate-route" | "go-router" | "navigator-push" | "getx-page";
}

export interface DiagnosticEntry {
  code: string;
  message: string;
}

export interface RouteGraphResult {
  routes: RouteEntry[];
  diagnostics: DiagnosticEntry[];
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

export async function discoverRouteGraph(
  projectPath: string,
  symbolTable: SymbolTable
): Promise<RouteGraphResult> {
  const seen = new Set<string>();
  const routes: RouteEntry[] = [];
  const diagnostics: DiagnosticEntry[] = [];

  function addRoute(className: string, source: RouteEntry["source"]) {
    if (seen.has(className)) return;
    seen.add(className);

    if (!symbolTable.classes.has(className)) {
      diagnostics.push({
        code: "UNRESOLVED_CLASS",
        message: `라우트에 참조된 클래스 '${className}'를 프로젝트에서 찾을 수 없음`,
      });
      return;
    }

    routes.push({ className, source });
  }

  // main.dart 분석
  const mainArgs = await extractFromMainDart(projectPath);

  for (const cls of mainArgs.routeClasses) addRoute(cls, "routes-table");
  if (mainArgs.homeClass) addRoute(mainArgs.homeClass, "home");
  for (const cls of mainArgs.onGenerateRouteClasses) addRoute(cls, "on-generate-route");
  for (const cls of mainArgs.goRouterClasses) addRoute(cls, "go-router");

  // GetX: 프로젝트 전체에서 GetPage(name:, page:) 스캔 (라우트 테이블이 별도 파일이어도 발견)
  const getx = discoverGetxRoutes(symbolTable);
  for (const page of getx.pages) {
    if (page.className) addRoute(page.className, "getx-page");
  }

  // 프로젝트 전체 파일에서 Navigator.push 스캔
  for (const [, parsedFile] of symbolTable.files) {
    const pushClasses = scanNavigatorPush(parsedFile.root);
    for (const cls of pushClasses) addRoute(cls, "navigator-push");
  }

  return { routes, diagnostics };
}
