/**
 * handlerResolver — 핸들러(onPressed/onTap 등) 사이트 수집과 간접 참조 추적
 *
 * 실전 앱은 핸들러를 인라인 클로저로만 쓰지 않는다:
 *   onPressed: _goHome                      // 같은 클래스 메서드 참조
 *   onPressed: controller.openSettings      // tear-off
 *   onTap: () => controller.openSettings()  // 클로저 → 메서드 호출
 * 이 모듈은 각 핸들러가 "어떤 메서드를 참조하는지"(refMethodNames)를 추출해,
 * 메서드 본문 안의 네비게이션 호출을 트리거 버튼과 역으로 연결할 수 있게 한다.
 *
 * 결정론 보장: 모든 수집은 AST 순회 순서(소스 순서) 기반.
 */

import type { SyntaxNode } from "@karax/adapter-api";
import type { ParsedFile, SymbolTable } from "./scanner.js";
import { findNodes, findChild } from "./scanner.js";

// ── 핸들러 라벨 → 트리거 종류 ─────────────────────────────────────────────────

export const HANDLER_LABELS: ReadonlyMap<string, "button" | "tap"> = new Map([
  ["onPressed", "button"],
  ["onTap", "tap"],
  ["onLongPress", "tap"],
  ["onDoubleTap", "tap"],
  ["onSubmitted", "tap"],
  ["onSelected", "tap"],
]);

// ── 위젯 클래스 판정 ──────────────────────────────────────────────────────────

/** 화면 위젯으로 간주하는 슈퍼클래스들 (GetX/Riverpod/Hooks 포함) */
export const WIDGET_SUPERCLASSES: ReadonlySet<string> = new Set([
  "StatelessWidget",
  "StatefulWidget",
  "HookWidget",
  "ConsumerWidget",
  "ConsumerStatefulWidget",
  "GetView",
  "GetWidget",
]);

/**
 * 클래스명을 화면 위젯 클래스로 해석한다.
 * - 위젯 슈퍼클래스 상속 → 자기 자신
 * - State<X>/ConsumerState<X> → X
 * - 그 외 → undefined
 */
export function resolveWidgetClass(
  className: string,
  table: SymbolTable
): string | undefined {
  const ci = table.classes.get(className);
  if (!ci) return undefined;
  if (WIDGET_SUPERCLASSES.has(ci.superclass)) return className;
  if (
    (ci.superclass === "State" || ci.superclass === "ConsumerState") &&
    ci.superTypeArg
  ) {
    return ci.superTypeArg;
  }
  return undefined;
}

// ── AST 조상 탐색 ─────────────────────────────────────────────────────────────

/** 노드를 감싸는 가장 가까운 class_definition의 클래스명 */
export function enclosingClassName(node: SyntaxNode): string | undefined {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === "class_definition") {
      return findChild(cur, "identifier")?.text;
    }
    cur = cur.parent;
  }
  return undefined;
}

/**
 * 노드를 감싸는 가장 가까운 메서드/함수 이름.
 * tree-sitter-dart에서 메서드 본문(function_body)의 직전 형제가
 * method_signature/function_signature다. (클로저의 function_expression은 건너뜀)
 */
export function enclosingMethodName(node: SyntaxNode): string | undefined {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === "function_body") {
      let prev: SyntaxNode | null = cur.previousSibling;
      // annotation 등 건너뛰기
      while (prev && prev.type !== "method_signature" && prev.type !== "function_signature") {
        prev = prev.previousSibling;
      }
      if (prev) {
        const sig =
          prev.type === "method_signature"
            ? findChild(prev, "function_signature") ?? prev
            : prev;
        const id = findChild(sig, "identifier");
        if (id) return id.text;
      }
    }
    cur = cur.parent;
  }
  return undefined;
}

/** 노드를 감싸는 가장 가까운 핸들러 named_argument (onPressed/onTap 등) */
export function nearestEnclosingHandler(node: SyntaxNode): SyntaxNode | undefined {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === "named_argument") {
      const labelNode = findChild(cur, "label");
      const id = labelNode ? findChild(labelNode, "identifier") : undefined;
      if (id && HANDLER_LABELS.has(id.text)) return cur;
    }
    cur = cur.parent;
  }
  return undefined;
}

// ── 호출 체인 파싱 (Navigator.of(ctx).push(...) / controller.openX() 등) ─────

export interface ChainPair {
  /** 선택자 메서드명 (.push 등). 베이스 식별자 직접 호출이면 undefined */
  method?: string;
  /** 해당 호출의 arguments 노드 */
  args?: SyntaxNode;
}

/**
 * 식별자 노드 뒤로 이어지는 selector 체인을 (메서드, 인자) 쌍 목록으로 파싱한다.
 * 예) Navigator.of(context).pushNamed('/x')
 *   → [{method:"of", args:(context)}, {method:"pushNamed", args:('/x')}]
 * 예) _goHome() → [{method: undefined, args:()}]
 */
/** 비정상적으로 깊은 selector 체인 방어 (자원 고갈 방지) */
const MAX_CHAIN_DEPTH = 64;

export function chainPairs(idNode: SyntaxNode): ChainPair[] {
  const pairs: ChainPair[] = [];
  let pending: string | undefined;
  let cur: SyntaxNode | null = idNode.nextSibling;
  let depth = 0;

  while (cur && cur.type === "selector" && depth++ < MAX_CHAIN_DEPTH) {
    const uas = findChild(cur, "unconditional_assignable_selector");
    const methodId = uas ? findChild(uas, "identifier") : undefined;
    const ap = findChild(cur, "argument_part");

    if (methodId) {
      if (pending !== undefined) pairs.push({ method: pending });
      pending = methodId.text;
    }
    if (ap) {
      const args = findChild(ap, "arguments");
      pairs.push({ ...(pending !== undefined ? { method: pending } : {}), ...(args ? { args } : {}) });
      pending = undefined;
    }
    cur = cur.nextSibling;
  }
  if (pending !== undefined) pairs.push({ method: pending });
  return pairs;
}

// ── 핸들러 사이트 수집 ────────────────────────────────────────────────────────

export interface HandlerSite {
  file: string;
  /** named_argument 1-based 라인 (트리거 elementRef로 사용) */
  line: number;
  kind: "button" | "tap";
  /** 버튼/위젯 라벨 (child Text 리터럴 등) */
  label?: string;
  /** 핸들러가 위치한 클래스명 (raw) */
  enclosingClass?: string;
  /** enclosingClass를 화면 위젯으로 해석한 결과 */
  widgetClass?: string;
  /** 핸들러가 참조하는 메서드명들 (간접 추적용) */
  refMethodNames: string[];
}

/**
 * 핸들러 값에서 참조 메서드명들을 추출한다.
 * - 식별자 참조: onPressed: _goHome → ["_goHome"]
 * - tear-off: onPressed: controller.openSettings → ["openSettings"]
 * - 클로저: 본문 안의 메서드 호출들 (Navigator/Get/위젯 생성자는 제외)
 */
function extractRefMethodNames(valueChildren: SyntaxNode[]): string[] {
  const names = new Set<string>();
  if (valueChildren.length === 0) return [];

  const first = valueChildren[0]!;

  // 단순 식별자 참조: onPressed: _goHome
  if (valueChildren.length === 1 && first.type === "identifier") {
    return [first.text];
  }

  // tear-off: [identifier, selector(.name)] — argument_part 없음
  if (first.type === "identifier") {
    const pairs = chainPairs(first);
    const last = pairs[pairs.length - 1];
    if (last?.method && !last.args && !/^[A-Z]/.test(last.method)) {
      names.add(last.method);
    }
  }

  // 클로저: 본문 안의 호출 수집
  for (const child of valueChildren) {
    if (child.type !== "function_expression") continue;
    for (const id of findNodes(child, "identifier")) {
      // Navigator/Get 직접 호출은 lexical 귀속으로 처리되므로 제외.
      // 대문자 시작은 위젯/클래스 생성자로 간주해 제외.
      if (id.text === "Navigator" || id.text === "Get" || /^[A-Z]/.test(id.text)) continue;
      const pairs = chainPairs(id);
      for (const p of pairs) {
        if (p.args) {
          const m = p.method ?? id.text;
          if (m && !/^[A-Z]/.test(m)) names.add(m);
          break; // 베이스당 첫 호출만
        }
      }
    }
  }

  return [...names];
}

/** named_argument 노드를 HandlerSite로 변환한다. */
export function handlerSiteOf(
  na: SyntaxNode,
  parsedFile: ParsedFile,
  table: SymbolTable
): HandlerSite | undefined {
  const labelNode = findChild(na, "label");
  const labelId = labelNode ? findChild(labelNode, "identifier") : undefined;
  const kind = labelId ? HANDLER_LABELS.get(labelId.text) : undefined;
  if (!kind) return undefined;

  const valueChildren = na.children.filter(
    (c): c is SyntaxNode => c !== null && c.type !== "label"
  );

  const label = findButtonLabelForHandler(na);
  const enclosingClass = enclosingClassName(na);
  const widgetClass = enclosingClass
    ? resolveWidgetClass(enclosingClass, table)
    : undefined;

  return {
    file: parsedFile.filePath,
    line: na.startPosition.row + 1,
    kind,
    ...(label ? { label } : {}),
    ...(enclosingClass ? { enclosingClass } : {}),
    ...(widgetClass ? { widgetClass } : {}),
    refMethodNames: extractRefMethodNames(valueChildren),
  };
}

/** 파일 전체에서 핸들러 사이트를 수집한다. */
export function scanHandlerSites(
  parsedFile: ParsedFile,
  table: SymbolTable
): HandlerSite[] {
  const sites: HandlerSite[] = [];
  for (const na of findNodes(parsedFile.root, "named_argument")) {
    const site = handlerSiteOf(na, parsedFile, table);
    if (site) sites.push(site);
  }
  return sites;
}

// ── 버튼 라벨 추출 ────────────────────────────────────────────────────────────

/**
 * 핸들러 named_argument의 형제 child: 인자에서 Text('...') 리터럴 라벨을 추출한다.
 * 구조: named_argument(onPressed) → arguments → [named_argument(child), ...]
 */
export function findButtonLabelForHandler(na: SyntaxNode): string | undefined {
  const argsNode = na.parent;
  if (!argsNode || argsNode.type !== "arguments") return undefined;

  // child: 또는 title: 인자
  for (const labelName of ["child", "title", "label", "icon"]) {
    const childArg = getNamedArgLocal(argsNode, labelName);
    if (!childArg) continue;
    const text = extractTextLiteral(childArg);
    if (text) return text;
  }
  return undefined;
}

/** named_argument 목록에서 label명으로 값 노드를 찾는다 (routeGraph 의존 회피용 로컬 구현) */
function getNamedArgLocal(argsNode: SyntaxNode, label: string): SyntaxNode | undefined {
  for (const child of argsNode.children) {
    if (!child || child.type !== "named_argument") continue;
    const labelNode = findChild(child, "label");
    const id = labelNode ? findChild(labelNode, "identifier") : undefined;
    if (id?.text === label) {
      return child.children.find((c): c is SyntaxNode => c !== null && c.type !== "label") ?? undefined;
    }
  }
  return undefined;
}

/** 노드 안의 Text('...')/리터럴에서 첫 문자열을 추출한다. */
function extractTextLiteral(node: SyntaxNode): string | undefined {
  // const Text('...') — const_object_expression
  for (const obj of findNodes(node, "const_object_expression")) {
    const typeId = findChild(obj, "type_identifier");
    if (typeId?.text !== "Text") continue;
    const argsEl = findChild(obj, "arguments");
    if (!argsEl) continue;
    const strLit = findNodes(argsEl, "string_literal")[0];
    if (strLit) return stripQuotes(strLit.text);
  }
  // non-const Text('...')
  for (const id of findNodes(node, "identifier")) {
    if (id.text !== "Text") continue;
    const sel = id.nextSibling as SyntaxNode | null;
    if (!sel || sel.type !== "selector") continue;
    const ap = findChild(sel, "argument_part");
    if (!ap) continue;
    const textArgs = findChild(ap, "arguments");
    if (!textArgs) continue;
    const strLit = findNodes(textArgs, "string_literal")[0];
    if (strLit) return stripQuotes(strLit.text);
  }
  return undefined;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, "");
}
