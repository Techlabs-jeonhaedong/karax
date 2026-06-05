/**
 * navGraph — React Native 화면 간 네비게이션 엣지 추출
 *
 * 전략:
 * 1. App.tsx에서 Stack.Screen name→component 맵 구성 (기존 routeGraph 재사용)
 * 2. 각 화면 파일에서 onPress Arrow 내 navigation.navigate/push/goBack 탐색
 * 3. 라우트명 → 컴포넌트명 변환, 라벨 추출
 */

import path from "path";
import { readFile } from "fs/promises";
import type { SyntaxNode } from "@karax/adapter-api";
import type { NavigationGraph, NavigationEdge, TriggerInfo } from "@karax/core";
import type { SymbolTable } from "../parse/scanner.js";
import { findNodes, findChild, filterChildren } from "../parse/scanner.js";
import { discoverRouteGraph } from "./routeGraph.js";

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface NavCallInfo {
  kind: "navigate" | "push" | "pop";
  routeName?: string;
  /** routeName이 없는 동적 인자(변수/표현식) 케이스 */
  isDynamic?: boolean;
  label?: string;
}

// ── JSX 어트리뷰트 / 텍스트 추출 유틸 ────────────────────────────────────────

function getJsxAttrString(element: SyntaxNode, attrName: string): string | undefined {
  const attrs = findNodes(element, "jsx_attribute");
  for (const attr of attrs) {
    const attrId = attr.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!attrId || attrId.text !== attrName) continue;
    const strFrag = findNodes(attr, "string_fragment")[0];
    if (strFrag) return strFrag.text;
    const strNode = findNodes(attr, "string")[0];
    if (strNode) return strNode.text.replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

/** Button title 어트리뷰트 값 추출 */
function extractButtonTitle(element: SyntaxNode): string | undefined {
  return getJsxAttrString(element, "title");
}

// ── onPress 핸들러에서 navigation 호출 탐색 ──────────────────────────────────

function extractNavCallsFromHandler(handlerNode: SyntaxNode): NavCallInfo[] {
  const results: NavCallInfo[] = [];

  // call_expression 중 navigation.navigate / navigation.push / navigation.goBack 탐색
  const callExprs = findNodes(handlerNode, "call_expression");
  for (const call of callExprs) {
    const funcNode = call.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "member_expression"
    );
    if (!funcNode) continue;

    const methodId = funcNode.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!methodId) continue;

    const methText = methodId.text;

    if (methText === "navigate" || methText === "push") {
      // 첫 번째 인자: 라우트명 string 또는 동적 표현식
      const args = findChild(call, "arguments");
      if (!args) continue;
      const strFrag = findNodes(args, "string_fragment")[0];
      const routeName = strFrag?.text;
      if (routeName) {
        results.push({ kind: methText === "push" ? "push" : "navigate", routeName });
      } else {
        // 인자가 있는데 string이 아닌 경우 = 동적 표현식 → isDynamic 플래그
        const hasArg = args.children.some(
          (c): c is typeof args.children[number] => c !== null && c.type !== "," && c.type !== "(" && c.type !== ")"
        );
        if (hasArg) {
          results.push({ kind: methText === "push" ? "push" : "navigate", isDynamic: true });
        }
      }
    } else if (methText === "goBack") {
      results.push({ kind: "pop" });
    }
  }

  return results;
}

// ── onPress 핸들러를 가진 요소(TouchableOpacity, Button, Pressable) 스캔 ────

function scanOnPressHandlers(root: SyntaxNode): Array<{
  calls: NavCallInfo[];
  label?: string;
  triggerLine?: number;
}> {
  const results: Array<{ calls: NavCallInfo[]; label?: string; triggerLine?: number }> = [];

  // JSX attribute에서 onPress를 찾는다
  const attrs = findNodes(root, "jsx_attribute");
  for (const attr of attrs) {
    const attrId = attr.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!attrId || attrId.text !== "onPress") continue;

    // 핸들러 값 (jsx_expression 안의 arrow_function 또는 function_expression)
    const jsxExpr = findChild(attr, "jsx_expression");
    if (!jsxExpr) continue;

    const handlerNode =
      findChild(jsxExpr, "arrow_function") ??
      findChild(jsxExpr, "function_expression") ??
      jsxExpr;

    const calls = extractNavCallsFromHandler(handlerNode);
    if (calls.length === 0) continue;

    // onPress attr 자체의 1-based 라인을 트리거 라인으로 사용
    const triggerLine = attr.startPosition.row + 1;

    // 라벨 탐색: 이 attr의 상위 JSX 요소에서 title 또는 Text 자식 추출
    let label: string | undefined;

    // 부모 JSX 요소 찾기 (attr → jsx_opening_element 또는 jsx_self_closing_element)
    const jsxElement = attr.parent?.parent; // attr → opening_element → jsx_element
    if (jsxElement) {
      // Button의 title prop
      label = getJsxAttrString(jsxElement, "title");
      if (!label) {
        // Text 자식의 string_fragment
        const textChildren = findNodes(jsxElement, "jsx_element").filter((el) => {
          const open = el.children.find(
            (c): c is SyntaxNode => c !== null && c.type === "jsx_opening_element"
          );
          const tagName = open?.children.find(
            (c): c is SyntaxNode =>
              c !== null &&
              (c.type === "identifier" || c.type === "jsx_identifier")
          );
          return tagName?.text === "Text";
        });
        for (const textEl of textChildren) {
          const strFrag = findNodes(textEl, "string_fragment")[0];
          if (strFrag) {
            label = strFrag.text;
            break;
          }
          const jsxText = textEl.children.find(
            (c): c is SyntaxNode => c !== null && c.type === "jsx_text"
          );
          if (jsxText) {
            label = jsxText.text.trim();
            break;
          }
        }
      }
    }

    for (const call of calls) {
      results.push({ calls: [call], label, triggerLine });
    }
  }

  return results;
}

// ── index.js에서 루트 컴포넌트명 추출 ────────────────────────────────────────

async function findRootComponentName(projectPath: string): Promise<string | undefined> {
  for (const fileName of ["index.js", "index.ts", "index.tsx"]) {
    try {
      const source = await readFile(path.join(projectPath, fileName), "utf-8");
      const match = source.match(
        /AppRegistry\.registerComponent\s*\([^,]+,\s*\(\s*\)\s*=>\s*([A-Za-z_]\w*)/
      );
      if (match?.[1]) return match[1];
    } catch {
      // 다음 파일 시도
    }
  }
  return undefined;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * React Native 프로젝트에서 화면 간 네비게이션 그래프를 추출한다.
 */
export async function discoverRNNavGraph(
  projectPath: string,
  symbolTable: SymbolTable
): Promise<NavigationGraph> {
  const edges: NavigationEdge[] = [];
  const diagnostics: NavigationGraph["diagnostics"] = [];

  // 1. 라우트 맵 구성 (name → componentName)
  const routeGraphResult = await discoverRouteGraph(projectPath, symbolTable);
  const routeToComponent = new Map<string, string>();
  for (const route of routeGraphResult.routes) {
    routeToComponent.set(route.name, route.componentName);
  }

  // 진입점: initialRouteName="Home" → componentName 해석
  // App.tsx에서 initialRouteName 추출
  let entryScreenId: string | null = null;
  try {
    const appContent = await readFile(
      path.join(projectPath, "App.tsx"),
      "utf-8"
    );
    const initialMatch = appContent.match(
      /initialRouteName\s*=\s*["']([^"']+)["']/
    );
    if (initialMatch?.[1]) {
      const compName = routeToComponent.get(initialMatch[1]);
      entryScreenId = compName ?? null;
    }
  } catch {
    // App.tsx 없음
  }

  // entryScreenId를 못 찾으면 routes[0]의 컴포넌트를 사용
  if (!entryScreenId && routeGraphResult.routes.length > 0) {
    entryScreenId = routeGraphResult.routes[0]!.componentName;
  }

  // 2. 각 화면 파일에서 onPress 핸들러 스캔
  for (const [, parsedFile] of symbolTable.files) {
    // 이 파일의 컴포넌트명 찾기
    const comp = [...symbolTable.components.values()].find(
      (c) => c.file === parsedFile.filePath
    );
    if (!comp) continue;

    const fromId = comp.name;

    const handlers = scanOnPressHandlers(parsedFile.root);
    for (const { calls: handlerCalls, label, triggerLine } of handlers) {
      // elementRef: onPress attr의 위치
      const elementRef: TriggerInfo["elementRef"] = triggerLine !== undefined
        ? { file: parsedFile.filePath, line: triggerLine }
        : undefined;

      for (const call of handlerCalls) {
        const trigger: TriggerInfo = {
          kind: "button",
          ...(label ? { label } : {}),
          ...(elementRef ? { elementRef } : {}),
        };

        if (call.kind === "navigate" || call.kind === "push") {
          // 동적 인자 케이스: DYNAMIC_NAV emit
          if (call.isDynamic) {
            edges.push({
              from: fromId,
              to: null,
              action: "navigate",
              trigger,
              confidence: 0.3,
              diagnostics: [
                {
                  code: "DYNAMIC_NAV",
                  message: "navigate() 인자가 동적 표현식이라 정적 해석 불가",
                },
              ],
            });
            continue;
          }

          const targetComp = routeToComponent.get(call.routeName ?? "");
          const toId = targetComp ?? null;
          const toRouteName = call.routeName;

          if (toId) {
            edges.push({
              from: fromId,
              to: toId,
              toRouteName,
              action: "navigate",
              trigger,
              confidence: 1.0,
              diagnostics: [],
            });
          } else {
            edges.push({
              from: fromId,
              to: null,
              toRouteName,
              action: "navigate",
              trigger,
              confidence: 0.6,
              diagnostics: [
                {
                  code: "UNRESOLVED_NAV",
                  message: `navigate('${call.routeName}') 컴포넌트를 찾을 수 없음`,
                },
              ],
            });
          }
        } else if (call.kind === "pop") {
          edges.push({
            from: fromId,
            to: null,
            action: "pop",
            trigger: { kind: "back", ...(elementRef ? { elementRef } : {}) },
            confidence: 1.0,
            diagnostics: [],
          });
        }
      }
    }
  }

  return { entryScreenId, edges, diagnostics };
}

/**
 * app.json displayName 또는 package.json name에서 앱 이름을 읽는다.
 */
export async function readRNAppName(
  projectPath: string
): Promise<string | undefined> {
  // app.json 시도
  try {
    const appJson = JSON.parse(
      await readFile(path.join(projectPath, "app.json"), "utf-8")
    ) as { displayName?: string; name?: string };
    if (appJson.displayName) return appJson.displayName;
    if (appJson.name) return appJson.name;
  } catch {
    // app.json 없음
  }

  // package.json name fallback
  try {
    const pkgJson = JSON.parse(
      await readFile(path.join(projectPath, "package.json"), "utf-8")
    ) as { name?: string };
    return pkgJson.name;
  } catch {
    return undefined;
  }
}
