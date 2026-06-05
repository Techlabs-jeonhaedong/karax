/**
 * navGraph — Flutter 화면 간 네비게이션 엣지 추출
 *
 * 전략:
 * 1. main.dart에서 routes: {} 테이블 파싱 → route→className 맵 구성
 * 2. 각 화면 파일에서 onPressed/onTap 클로저 내 Navigator.push/pushNamed/pop 탐색
 * 3. 버튼 child Text 리터럴을 라벨로 추출
 * 4. pushNamed('/x') → routes 테이블 역참조로 to 확정
 */

import path from "path";
import { readFile } from "fs/promises";
import { withParsedSource, type SyntaxNode } from "@karax/adapter-api";
import type { NavigationGraph, NavigationEdge, TriggerInfo } from "@karax/core";
import type { SymbolTable } from "../parse/scanner.js";
import { findNodes, findChild, filterChildren } from "../parse/scanner.js";
import { readPackageName } from "../parse/pubspec.js";
import {
  findByIdentifier,
  getNamedArg,
  extractWidgetClassFromBuilder,
  extractFromMaterialPageRoute,
} from "./routeGraph.js";

// ── routes 테이블 파싱 (route → className 맵) ──────────────────────────────

interface RouteMapEntry {
  route: string;
  className: string;
}

function parseRoutesMapWithKeys(routesValue: SyntaxNode): RouteMapEntry[] {
  const result: RouteMapEntry[] = [];
  const pairs = findNodes(routesValue, "pair");
  for (const pair of pairs) {
    // 키: 문자열 리터럴 (route)
    const keyNode = pair.children.find(
      (c): c is SyntaxNode =>
        c !== null && c.type === "string_literal"
    );
    const route = keyNode?.text.replace(/^['"]|['"]$/g, "") ?? "";
    if (!route) continue;

    // 값: function_expression 또는 const_object_expression (className)
    const funcExpr = pair.children.find(
      (c): c is SyntaxNode =>
        c !== null &&
        (c.type === "function_expression" ||
          c.type === "const_object_expression")
    );
    if (!funcExpr) continue;

    let className: string | undefined;
    if (funcExpr.type === "const_object_expression") {
      className = findChild(funcExpr, "type_identifier")?.text;
    } else {
      className = extractWidgetClassFromBuilder(funcExpr);
    }

    if (className) result.push({ route, className });
  }
  return result;
}

// ── main.dart에서 routes 테이블 + home 추출 ────────────────────────────────

interface MainDartInfo {
  /** route → className */
  routeMap: Map<string, string>;
  /** home: 파라미터로 지정된 클래스명 */
  homeClass?: string;
}

async function extractMainDartInfo(
  projectPath: string
): Promise<MainDartInfo> {
  const mainPath = path.join(projectPath, "lib", "main.dart");
  let source: string;
  try {
    source = await readFile(mainPath, "utf-8");
  } catch {
    return { routeMap: new Map() };
  }

  return withParsedSource("dart", source, (root) => {
    const routeMap = new Map<string, string>();
    let homeClass: string | undefined;

    for (const appName of ["MaterialApp", "CupertinoApp"]) {
      const appIds = findByIdentifier(root, appName);
      for (const appId of appIds) {
        if (!appId.parent) continue;
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
          for (const entry of parseRoutesMapWithKeys(routesArg)) {
            routeMap.set(entry.route, entry.className);
          }
        }

        // home:
        const homeArg = getNamedArg(args, "home");
        if (homeArg && !homeClass) {
          if (homeArg.type === "const_object_expression") {
            homeClass = findChild(homeArg, "type_identifier")?.text;
          } else if (homeArg.type === "identifier") {
            homeClass = homeArg.text;
          }
        }
      }
    }

    return { routeMap, homeClass };
  });
}

// ── 버튼의 child Text 리터럴 추출 ─────────────────────────────────────────

/**
 * 버튼 위젯(ElevatedButton/OutlinedButton/TextButton)의
 * child: Text('...') 리터럴을 추출한다.
 */
function extractButtonLabel(buttonNode: SyntaxNode): string | undefined {
  // child named_argument → Text widget → string_literal
  // 버튼 args를 찾는다
  const selectors = filterChildren(buttonNode, "selector");
  let argsNode: SyntaxNode | undefined;
  for (const sel of selectors) {
    const ap = findChild(sel, "argument_part");
    if (ap) {
      argsNode = findChild(ap, "arguments");
      break;
    }
  }
  if (!argsNode) return undefined;

  const childArg = getNamedArg(argsNode, "child");
  if (!childArg) return undefined;

  // child: const Text('...') 또는 Text('...')
  const textIds = findByIdentifier(childArg, "Text");
  for (const textId of textIds) {
    // Text 다음 selector의 argument_part
    const selectorNode = textId.nextSibling as SyntaxNode | null;
    if (!selectorNode || selectorNode.type !== "selector") continue;
    const ap = findChild(selectorNode, "argument_part");
    if (!ap) continue;
    const textArgs = findChild(ap, "arguments");
    if (!textArgs) continue;
    // 첫 번째 string_literal
    const strLit = findNodes(textArgs, "string_literal")[0];
    if (strLit) {
      return strLit.text.replace(/^['"]|['"]$/g, "");
    }
  }

  return undefined;
}

// ── Navigator.push / pushNamed / pop 스캔 ───────────────────────────────────

interface NavCallInfo {
  /** Navigator 호출 종류 */
  kind: "push" | "pushNamed" | "pop";
  /** push: MaterialPageRoute builder에서 추출한 클래스명 */
  targetClass?: string;
  /** pushNamed: 라우트 이름 */
  routeName?: string;
  /** 해당 Navigator 호출이 속한 onPressed/onTap 값 노드 */
  handlerValueNode?: SyntaxNode;
  /** onPressed/onTap named_argument 노드의 1-based 라인 */
  triggerLine?: number;
}

/**
 * onPressed/onTap/onTapUp 핸들러 값 노드에서 NavCallInfo를 추출한다.
 * Navigator.push/pushNamed/pop 호출을 탐색한다.
 */
function extractNavCallsFromHandler(
  handlerValue: SyntaxNode,
  routeMap: Map<string, string>
): Array<{ kind: "push" | "pushNamed" | "pop"; targetClass?: string; routeName?: string }> {
  const results: Array<{
    kind: "push" | "pushNamed" | "pop";
    targetClass?: string;
    routeName?: string;
  }> = [];

  const navIds = findByIdentifier(handlerValue, "Navigator");
  for (const navId of navIds) {
    if (!navId.parent) continue;

    const selectorChain = filterChildren(navId.parent, "selector");
    if (selectorChain.length === 0) continue;

    // 첫 번째 selector에서 메서드명 추출
    const firstSel = selectorChain[0]!;
    // selector text: ".push(...)" → "push"
    const selText = firstSel.text ?? "";
    const methMatch = selText.match(/^\.(\w+)/);
    const methText = methMatch?.[1] ?? "";

    if (methText === "push") {
      // arguments 노드에서 MaterialPageRoute 탐색
      for (const sel of selectorChain) {
        const ap = findChild(sel, "argument_part");
        if (!ap) continue;
        const args = findChild(ap, "arguments");
        if (!args) continue;
        const mprIds = findByIdentifier(args, "MaterialPageRoute");
        for (const mprId of mprIds) {
          const mprSel = mprId.nextSibling as SyntaxNode | null;
          if (!mprSel || mprSel.type !== "selector") continue;
          const mprAp = findChild(mprSel, "argument_part");
          if (!mprAp) continue;
          const mprArgs = findChild(mprAp, "arguments");
          if (!mprArgs) continue;
          const targetClass = extractFromMaterialPageRoute(mprArgs);
          results.push({ kind: "push", targetClass });
          break;
        }
        break;
      }
    } else if (methText === "pushNamed") {
      for (const sel of selectorChain) {
        const ap = findChild(sel, "argument_part");
        if (!ap) continue;
        const args = findChild(ap, "arguments");
        if (!args) continue;
        // pushNamed(context, '/route') — string_literal이 route
        const strLit = findNodes(args, "string_literal")[0];
        const routeName = strLit?.text.replace(/^['"]|['"]$/g, "");
        if (routeName) {
          results.push({ kind: "pushNamed", routeName });
        }
        break;
      }
    } else if (methText === "pop") {
      results.push({ kind: "pop" });
    }
  }

  return results;
}

/**
 * 파일 전체에서 onPressed/onTap named_argument를 탐색하고,
 * 그 핸들러 클로저 안의 Navigator 호출 + 라벨을 추출한다.
 */
function scanNavCalls(root: SyntaxNode, routeMap: Map<string, string>): NavCallInfo[] {
  const results: NavCallInfo[] = [];

  // onPressed/onTap named_argument를 모두 탐색
  const namedArgs = findNodes(root, "named_argument");
  for (const na of namedArgs) {
    const labelNode = findChild(na, "label");
    const labelId = labelNode ? findChild(labelNode, "identifier") : undefined;
    const labelText = labelId?.text ?? "";
    if (labelText !== "onPressed" && labelText !== "onTap") continue;

    // 핸들러 값 노드 (label 이후 첫 번째 비-label 자식)
    const handlerValue = na.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "label"
    );
    if (!handlerValue) continue;

    // named_argument 노드 자체의 라인(1-based)을 트리거 라인으로 사용
    const triggerLine = na.startPosition.row + 1;

    const calls = extractNavCallsFromHandler(handlerValue, routeMap);
    for (const call of calls) {
      results.push({
        ...call,
        handlerValueNode: handlerValue,
        triggerLine,
      });
    }
  }

  return results;
}

/**
 * onPressed/onTap 핸들러의 named_argument 부모에서 상위 버튼 arguments를 찾아
 * child: Text('...') 라벨을 추출한다.
 *
 * 구조: handlerValue → named_argument(onPressed) → arguments → [named_argument(child), ...]
 */
function findButtonLabelForHandlerValue(handlerValue: SyntaxNode): string | undefined {
  // handlerValue → named_argument(onPressed) → arguments
  const namedArg = handlerValue.parent;
  if (!namedArg || namedArg.type !== "named_argument") return undefined;
  const argsNode = namedArg.parent;
  if (!argsNode || argsNode.type !== "arguments") return undefined;

  // argsNode는 버튼의 arguments — 여기서 child: 인자를 찾는다
  const childArg = getNamedArg(argsNode, "child");
  if (!childArg) return undefined;

  // child: const Text('...') 또는 Text('...')
  // const_object_expression: [const, type_identifier(Text), arguments]
  const constObjs = findNodes(childArg, "const_object_expression");
  for (const obj of constObjs) {
    const typeId = findChild(obj, "type_identifier");
    if (typeId?.text !== "Text") continue;
    const argsEl = findChild(obj, "arguments");
    if (!argsEl) continue;
    const strLit = findNodes(argsEl, "string_literal")[0];
    if (strLit) {
      return strLit.text.replace(/^['"]|['"]$/g, "");
    }
  }

  // non-const Text: identifier(Text) + selector(argument_part)
  const textIds = findByIdentifier(childArg, "Text");
  for (const textId of textIds) {
    const selectorNode = textId.nextSibling as SyntaxNode | null;
    if (!selectorNode || selectorNode.type !== "selector") continue;
    const ap = findChild(selectorNode, "argument_part");
    if (!ap) continue;
    const textArgs = findChild(ap, "arguments");
    if (!textArgs) continue;
    const strLit = findNodes(textArgs, "string_literal")[0];
    if (strLit) {
      return strLit.text.replace(/^['"]|['"]$/g, "");
    }
  }

  return undefined;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * Flutter 프로젝트에서 화면 간 네비게이션 그래프를 추출한다.
 */
export async function discoverFlutterNavGraph(
  projectPath: string,
  symbolTable: SymbolTable
): Promise<NavigationGraph> {
  const edges: NavigationEdge[] = [];
  const diagnostics: NavigationGraph["diagnostics"] = [];

  // 1. routes 테이블 + home 추출
  const mainInfo = await extractMainDartInfo(projectPath);
  const { routeMap, homeClass } = mainInfo;

  // 진입점 결정
  const entryScreenId =
    homeClass ??
    (routeMap.has("/") ? routeMap.get("/") ?? null : null);

  // 2. 각 화면 파일에서 Navigator 호출 스캔
  for (const [, parsedFile] of symbolTable.files) {
    // 이 파일에 속한 클래스들
    const fileClasses = parsedFile.classes.map((c) => c.name);

    const navCalls = scanNavCalls(parsedFile.root, routeMap);
    if (navCalls.length === 0) continue;

    // 파일의 클래스를 from으로 특정
    // 가능한 경우 StatelessWidget/StatefulWidget을 상속한 클래스 우선 선택
    const mainClass =
      fileClasses.find((name) => {
        const info = symbolTable.classes.get(name);
        return (
          info &&
          (info.superclass === "StatelessWidget" ||
            info.superclass === "StatefulWidget")
        );
      }) ?? fileClasses.find((name) => symbolTable.classes.has(name));

    if (!mainClass) continue;

    for (const call of navCalls) {
      // 버튼 라벨 추출
      const label = call.handlerValueNode
        ? findButtonLabelForHandlerValue(call.handlerValueNode)
        : undefined;

      // elementRef: 트리거 위젯(onPressed/onTap named_argument)의 위치
      const elementRef: TriggerInfo["elementRef"] = call.triggerLine !== undefined
        ? { file: parsedFile.filePath, line: call.triggerLine }
        : undefined;

      const trigger: TriggerInfo = {
        kind: "button",
        ...(label ? { label } : {}),
        ...(elementRef ? { elementRef } : {}),
      };

      if (call.kind === "push" && call.targetClass) {
        if (symbolTable.classes.has(call.targetClass)) {
          edges.push({
            from: mainClass,
            to: call.targetClass,
            action: "push",
            trigger,
            confidence: 1.0,
            diagnostics: [],
          });
        } else {
          edges.push({
            from: mainClass,
            to: null,
            action: "push",
            trigger,
            confidence: 0.3,
            diagnostics: [
              {
                code: "UNRESOLVED_NAV",
                message: `Navigator.push 대상 '${call.targetClass}'를 찾을 수 없음`,
              },
            ],
          });
        }
      } else if (call.kind === "pushNamed" && call.routeName) {
        const targetClass = routeMap.get(call.routeName);
        if (targetClass) {
          edges.push({
            from: mainClass,
            to: targetClass,
            action: "push",
            trigger,
            confidence: 1.0,
            diagnostics: [],
          });
        } else {
          edges.push({
            from: mainClass,
            to: null,
            action: "push",
            trigger: { ...trigger, label: label ?? call.routeName },
            confidence: 0.6,
            diagnostics: [
              {
                code: "UNRESOLVED_NAV",
                message: `pushNamed('${call.routeName}') 라우트를 routes 테이블에서 찾을 수 없음`,
              },
            ],
          });
        }
      } else if (call.kind === "pop") {
        edges.push({
          from: mainClass,
          to: null,
          action: "pop",
          trigger: { kind: "back", ...(elementRef ? { elementRef } : {}) },
          confidence: 1.0,
          diagnostics: [],
        });
      }
    }
  }

  return { entryScreenId, edges, diagnostics };
}

/**
 * pubspec.yaml에서 앱 이름을 읽는다.
 */
export async function readFlutterAppName(
  projectPath: string
): Promise<string | undefined> {
  try {
    const pkgName = await readPackageName(projectPath);
    return pkgName;
  } catch {
    return undefined;
  }
}
