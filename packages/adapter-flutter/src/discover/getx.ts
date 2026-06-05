/**
 * getx — GetX 라우팅(GetPage/GetMaterialApp) 정적 분석
 *
 * 실전 GetX 앱 패턴 지원:
 * - 라우트 테이블이 main.dart가 아닌 임의 파일의 `static final routes = [GetPage(...)]`
 * - `GetPage(name: UnIPath.X, page: () => Screen())` — name이 상수 참조
 * - `GetMaterialApp(initialRoute: 상수)` → entry 화면 결정
 *
 * 전략: getPages 참조를 따라가는 대신 프로젝트 전체 파일에서 GetPage 호출을
 * 직접 스캔한다 (더 견고하고 결정론적 — 파일 순회는 정렬된 경로 순서).
 */

import type { SyntaxNode } from "@karax/adapter-api";
import type { SymbolTable } from "../parse/scanner.js";
import { findChild } from "../parse/scanner.js";
import { resolveStringExpr } from "../parse/constResolver.js";
import {
  findByIdentifier,
  getNamedArg,
  extractWidgetClassFromBuilder,
} from "./routeGraph.js";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface GetxPage {
  /** 해석된 라우트 경로 (예: "/splash"). 미해석 시 undefined */
  route?: string;
  /** route 미해석 시 원문 표현 (예: "UnIPath.SPLASH", "dynamicRoute") */
  routeRaw?: string;
  /** page 빌더에서 추출한 위젯 클래스명 */
  className?: string;
  /** GetPage 호출 위치 (프로젝트 루트 기준 상대 경로) */
  file: string;
  /** GetPage 호출 1-based 라인 */
  line: number;
}

export interface GetxRouteGraph {
  /** GetMaterialApp 사용 여부 */
  isGetxApp: boolean;
  pages: GetxPage[];
  /** route → className (중복 시 첫 값 유지) */
  routeMap: Map<string, string>;
  /** 해석된 initialRoute */
  initialRoute?: string;
  /** initialRoute → routeMap 역참조로 확정한 entry 클래스 */
  entryClass?: string;
}

// ── AST 헬퍼 ──────────────────────────────────────────────────────────────────

/** 호출 식별자 노드(GetPage 등)의 nextSibling selector에서 arguments를 찾는다 */
function callArguments(idNode: SyntaxNode): SyntaxNode | undefined {
  const selector = idNode.nextSibling as SyntaxNode | null;
  if (!selector || selector.type !== "selector") return undefined;
  const ap = findChild(selector, "argument_part");
  if (!ap) return undefined;
  return findChild(ap, "arguments");
}

/**
 * named_argument 값을 문자열로 해석한다.
 * - 리터럴: 값 노드가 string_literal
 * - 상수 참조: named_argument 자식이 [label, identifier, selector] 형태
 * 반환: { value: 해석값, raw: 원문 }
 */
export function resolveNamedArgString(
  argsNode: SyntaxNode,
  label: string,
  table: SymbolTable
): { value?: string; raw?: string } {
  // named_argument 노드를 직접 찾는다 (값 노드만으로는 selector가 잘릴 수 있음)
  for (const child of argsNode.children) {
    if (!child || child.type !== "named_argument") continue;
    const labelNode = findChild(child, "label");
    const labelId = labelNode ? findChild(labelNode, "identifier") : undefined;
    if (labelId?.text !== label) continue;

    const valueChildren = child.children.filter(
      (c): c is SyntaxNode => c !== null && c.type !== "label"
    );
    const raw = valueChildren.map((c) => c.text).join("") || undefined;

    // 1) 단일 값 노드가 string_literal 등인 경우
    if (valueChildren.length === 1) {
      const v = resolveStringExpr(valueChildren[0]!, table);
      if (v !== undefined) return { value: v, raw };
    }
    // 2) [identifier, selector] 멤버 참조 — named_argument 노드 자체로 해석
    const v = resolveStringExpr(child, table);
    return { value: v, raw };
  }
  return {};
}

// ── GetPage 스캔 ──────────────────────────────────────────────────────────────

function scanGetPages(table: SymbolTable): GetxPage[] {
  const pages: GetxPage[] = [];

  for (const [, parsedFile] of table.files) {
    const getPageIds = findByIdentifier(parsedFile.root, "GetPage");
    for (const idNode of getPageIds) {
      const args = callArguments(idNode);
      if (!args) continue;

      const { value: route, raw: routeRaw } = resolveNamedArgString(args, "name", table);

      const pageArg = getNamedArg(args, "page");
      const className = pageArg ? extractWidgetClassFromBuilder(pageArg) : undefined;

      pages.push({
        ...(route !== undefined ? { route } : {}),
        ...(route === undefined && routeRaw ? { routeRaw } : {}),
        ...(className ? { className } : {}),
        file: parsedFile.filePath,
        line: idNode.startPosition.row + 1,
      });
    }
  }

  return pages;
}

// ── GetMaterialApp 스캔 ───────────────────────────────────────────────────────

function scanGetMaterialApp(table: SymbolTable): { found: boolean; initialRoute?: string } {
  for (const [, parsedFile] of table.files) {
    const appIds = findByIdentifier(parsedFile.root, "GetMaterialApp");
    for (const idNode of appIds) {
      const args = callArguments(idNode);
      if (!args) {
        // 인자 없는 GetMaterialApp()도 GetX 앱으로 간주
        return { found: true };
      }
      const { value: initialRoute } = resolveNamedArgString(args, "initialRoute", table);
      return { found: true, ...(initialRoute !== undefined ? { initialRoute } : {}) };
    }
  }
  return { found: false };
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export function discoverGetxRoutes(table: SymbolTable): GetxRouteGraph {
  const app = scanGetMaterialApp(table);
  const pages = scanGetPages(table);

  const routeMap = new Map<string, string>();
  for (const page of pages) {
    if (page.route !== undefined && page.className && !routeMap.has(page.route)) {
      routeMap.set(page.route, page.className);
    }
  }

  const entryClass =
    app.initialRoute !== undefined ? routeMap.get(app.initialRoute) : undefined;

  return {
    isGetxApp: app.found,
    pages,
    routeMap,
    ...(app.initialRoute !== undefined ? { initialRoute: app.initialRoute } : {}),
    ...(entryClass ? { entryClass } : {}),
  };
}
