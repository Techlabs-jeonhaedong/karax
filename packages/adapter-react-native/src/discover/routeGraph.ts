/**
 * routeGraph — React Navigation 라우트 그래프 발견
 *
 * 발견 경로:
 * 1. index.js → AppRegistry.registerComponent → App 컴포넌트
 * 2. App 컴포넌트 파일 → NavigationContainer → createNativeStackNavigator/createStackNavigator/createBottomTabNavigator
 * 3. <Stack.Screen name="..." component={X} /> 파싱
 * 4. navigation.navigate("Name") 호출 추적 (보조)
 */

import path from "path";
import { readFile } from "fs/promises";
import { parseSource, type SyntaxNode } from "@karax/adapter-api";
import type { SymbolTable } from "../parse/scanner.js";
import { findNodes, findChild, filterChildren } from "../parse/scanner.js";

// ── 결과 타입 ────────────────────────────────────────────────────────────────

export interface RouteEntry {
  /** 라우트 이름 (예: "Home") */
  name: string;
  /** 매핑된 컴포넌트명 (예: "HomeScreen") */
  componentName: string;
  source: "stack-screen" | "tab-screen" | "navigate-call";
}

export interface DiagnosticEntry {
  code: string;
  message: string;
}

export interface RouteGraphResult {
  routes: RouteEntry[];
  diagnostics: DiagnosticEntry[];
}

// ── JSX attribute에서 값 추출 ─────────────────────────────────────────────────

/**
 * JSX 어트리뷰트(jsx_attribute)에서 name 어트리뷰트 값 (문자열)을 추출한다.
 */
function getJsxAttrString(element: SyntaxNode, attrName: string): string | undefined {
  const attrs = findNodes(element, "jsx_attribute");
  for (const attr of attrs) {
    // 직접 자식만: attr.children = [identifier, "=", attr_value]
    const attrId = attr.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!attrId || attrId.text !== attrName) continue;

    // 값: string 또는 jsx_expression
    const strFrag = findNodes(attr, "string_fragment")[0];
    if (strFrag) return strFrag.text;

    const strNode = findNodes(attr, "string")[0];
    if (strNode) return strNode.text.replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

/**
 * JSX 어트리뷰트에서 identifier 참조 값(component={HomeScreen})을 추출한다.
 */
function getJsxAttrIdentifier(element: SyntaxNode, attrName: string): string | undefined {
  const attrs = findNodes(element, "jsx_attribute");
  for (const attr of attrs) {
    const attrId = attr.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!attrId || attrId.text !== attrName) continue;

    // jsx_expression 안의 identifier
    const jsxExpr = findChild(attr, "jsx_expression");
    if (jsxExpr) {
      const id = findChild(jsxExpr, "identifier");
      if (id) return id.text;
    }
  }
  return undefined;
}

// ── Stack.Screen / Tab.Screen JSX 요소 파싱 ─────────────────────────────────

/**
 * JSX 요소 중 이름이 "*.Screen" 형태인 요소(Stack.Screen, Tab.Screen 등)를 파싱한다.
 */
function parseScreenElements(root: SyntaxNode): RouteEntry[] {
  const results: RouteEntry[] = [];

  // jsx_element와 jsx_self_closing_element 모두 검색
  const jsxSelfClosing = findNodes(root, "jsx_self_closing_element");
  const jsxElements = findNodes(root, "jsx_element");

  const processElement = (el: SyntaxNode, source: "stack-screen" | "tab-screen") => {
    const name = getJsxAttrString(el, "name");
    const comp = getJsxAttrIdentifier(el, "component");
    if (name && comp) {
      results.push({ name, componentName: comp, source });
    }
  };

  for (const el of jsxSelfClosing) {
    // 태그 이름: jsx_opening_element → member_expression (Stack.Screen) 또는 identifier
    // jsx_self_closing_element 자체에 직접 있음
    const tagText = el.children.find(
      (c): c is SyntaxNode =>
        c !== null &&
        (c.type === "member_expression" || c.type === "identifier")
    )?.text ?? "";

    if (tagText.endsWith(".Screen")) {
      const source = tagText.startsWith("Tab.") ? "tab-screen" : "stack-screen";
      processElement(el, source);
    }
  }

  for (const el of jsxElements) {
    const openTag = el.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "jsx_opening_element"
    );
    if (!openTag) continue;
    const tagText = openTag.children.find(
      (c): c is SyntaxNode =>
        c !== null &&
        (c.type === "member_expression" || c.type === "identifier")
    )?.text ?? "";

    if (tagText.endsWith(".Screen")) {
      const source = tagText.startsWith("Tab.") ? "tab-screen" : "stack-screen";
      processElement(el, source);
    }
  }

  return results;
}

// ── navigation.navigate() 호출 추적 ─────────────────────────────────────────

function scanNavigateCall(root: SyntaxNode): RouteEntry[] {
  const results: RouteEntry[] = [];
  const seen = new Set<string>();

  // call_expression 중 navigation.navigate 패턴 탐색
  const callExprs = findNodes(root, "call_expression");
  for (const call of callExprs) {
    const funcNode = call.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "member_expression"
    );
    if (!funcNode) continue;

    const methodId = funcNode.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (methodId?.text !== "navigate") continue;

    // 첫 번째 인자: 라우트 이름 문자열
    const args = findChild(call, "arguments");
    if (!args) continue;
    const strFrag = findNodes(args, "string_fragment")[0];
    const routeName = strFrag?.text;

    if (routeName && !seen.has(routeName)) {
      seen.add(routeName);
      results.push({ name: routeName, componentName: "", source: "navigate-call" });
    }
  }

  return results;
}

// ── index.js에서 AppRegistry.registerComponent → App 컴포넌트 추출 ────────────

async function findRootComponentName(projectPath: string): Promise<string | undefined> {
  const indexPath = path.join(projectPath, "index.js");
  let source: string;
  try {
    source = await readFile(indexPath, "utf-8");
  } catch {
    // index.ts 시도
    try {
      source = await readFile(path.join(projectPath, "index.ts"), "utf-8");
    } catch {
      return undefined;
    }
  }

  // AppRegistry.registerComponent('Name', () => App) 파싱
  // 두 번째 인자의 화살표 함수 return 값이 컴포넌트명
  const match = source.match(/AppRegistry\.registerComponent\s*\([^,]+,\s*\(\s*\)\s*=>\s*([A-Za-z_]\w*)/);
  return match?.[1];
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

export async function discoverRouteGraph(
  projectPath: string,
  symbolTable: SymbolTable
): Promise<RouteGraphResult> {
  const routes: RouteEntry[] = [];
  const diagnostics: DiagnosticEntry[] = [];
  const seenComponents = new Set<string>();

  // 1. 루트 컴포넌트 찾기
  const rootComponentName = await findRootComponentName(projectPath);

  // 2. 모든 파일에서 navigator 화면 파싱
  for (const [, parsedFile] of symbolTable.files) {
    const screenEntries = parseScreenElements(parsedFile.root);
    for (const entry of screenEntries) {
      if (seenComponents.has(entry.componentName)) continue;
      seenComponents.add(entry.componentName);

      // 컴포넌트가 심볼 테이블에 있는지 확인
      if (!symbolTable.components.has(entry.componentName)) {
        diagnostics.push({
          code: "UNRESOLVED_CLASS",
          message: `라우트에 참조된 컴포넌트 '${entry.componentName}'를 프로젝트에서 찾을 수 없음`,
        });
        continue;
      }

      routes.push(entry);
    }
  }

  // 3. navigation.navigate 호출 추적 (보조) — 이미 route-graph에 없는 것만
  if (routes.length > 0) {
    for (const [, parsedFile] of symbolTable.files) {
      const navigateCalls = scanNavigateCall(parsedFile.root);
      for (const call of navigateCalls) {
        // 이름으로 이미 추가된 경우 건너뜀
        const alreadyExists = routes.some(r => r.name === call.name);
        if (!alreadyExists) {
          // 라우트 이름으로 컴포넌트명 찾기 (예: "Home" → "HomeScreen")
          const matchedRoute = routes.find(r => r.name === call.name);
          if (!matchedRoute && call.name) {
            // 최선 노력: Name+"Screen" 형태로 컴포넌트 탐색
            const guessedComp = `${call.name}Screen`;
            if (symbolTable.components.has(guessedComp) && !seenComponents.has(guessedComp)) {
              seenComponents.add(guessedComp);
              routes.push({
                name: call.name,
                componentName: guessedComp,
                source: "navigate-call",
              });
            }
          }
        }
      }
    }
  }

  if (routes.length === 0 && rootComponentName) {
    diagnostics.push({
      code: "NO_NAVIGATOR",
      message: `네비게이터를 찾을 수 없음 — '${rootComponentName}'은 단일 화면 앱일 수 있음`,
    });
  }

  return { routes, diagnostics };
}
