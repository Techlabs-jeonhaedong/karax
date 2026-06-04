/**
 * Swift AST 유틸리티 — viewMapper / themeResolver / inliner에서 공통 사용
 */

import type { SyntaxNode } from "@sfc/adapter-api";

// ── 기본 탐색 ──────────────────────────────────────────────────────────────────

export function findAllNodes(node: SyntaxNode, type: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child) findAllNodes(child, type, results);
  }
  return results;
}

export function findChild(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.children.find((c): c is SyntaxNode => c !== null && c.type === type) ?? undefined;
}

export function filterChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.children.filter((c): c is SyntaxNode => c !== null && c.type === type);
}

// ── 위젯 이름 추출 ─────────────────────────────────────────────────────────────

/**
 * call_expression 또는 navigation_expression에서
 * 가장 안쪽의 실제 호출 함수명을 추출한다.
 *
 * 수정자 체인: Text("hi").font(.largeTitle).foregroundColor(.blue)
 * → navigation_expression 패턴이 중첩됨
 * → 가장 안쪽 call_expression의 simple_identifier가 "Text"
 */
export function extractCallName(node: SyntaxNode): string {
  if (node.type === "simple_identifier") return node.text;

  if (node.type === "call_expression") {
    const navExpr = findChild(node, "navigation_expression");
    if (navExpr) return extractCallName(navExpr);
    const simpleId = findChild(node, "simple_identifier");
    return simpleId?.text ?? "";
  }

  if (node.type === "navigation_expression") {
    // navigation_expression: [inner_call_or_nav, navigation_suffix]
    // 재귀적으로 안으로 파고들기
    const innerCall = findChild(node, "call_expression");
    const innerNav = findChild(node, "navigation_expression");
    const inner = innerCall ?? innerNav;
    if (inner) return extractCallName(inner);
    const simpleId = findChild(node, "simple_identifier");
    return simpleId?.text ?? "";
  }

  return "";
}

/**
 * call_expression에서 value_arguments 노드를 가져온다.
 * navigation_expression 체인이 있어도 올바르게 가장 바깥 call의 args를 반환한다.
 *
 * 주의: 수정자 체인에서는 가장 바깥 call이 수정자 호출이고
 *       가장 안쪽 call이 실제 위젯이다.
 *       여기서는 가장 안쪽 call_expression의 value_arguments를 반환한다.
 */
export function extractCallArgs(node: SyntaxNode): SyntaxNode | undefined {
  if (node.type === "call_expression") {
    const navExpr = findChild(node, "navigation_expression");
    if (navExpr) {
      // 수정자 체인 → 가장 안쪽 call을 찾기
      return extractCallArgsFromInnermost(navExpr);
    }
    const callSuffix = findChild(node, "call_suffix");
    if (callSuffix) return findChild(callSuffix, "value_arguments");
    return undefined;
  }

  if (node.type === "navigation_expression") {
    return extractCallArgsFromInnermost(node);
  }

  return undefined;
}

function extractCallArgsFromInnermost(nav: SyntaxNode): SyntaxNode | undefined {
  // navigation_expression 체인에서 가장 안쪽 call_expression을 찾는다
  let current: SyntaxNode = nav;
  let deepestCall: SyntaxNode | undefined;

  function findDeepest(n: SyntaxNode) {
    if (n.type === "call_expression") {
      // 이 call_expression이 가장 안쪽일 수 있음
      const navInner = findChild(n, "navigation_expression");
      if (navInner) {
        findDeepest(navInner);
        return;
      }
      deepestCall = n;
    } else if (n.type === "navigation_expression") {
      const callInner = findChild(n, "call_expression");
      const navInner = findChild(n, "navigation_expression");
      const inner = callInner ?? navInner;
      if (inner) findDeepest(inner);
      else deepestCall = findChild(n, "call_expression") ?? undefined;
    }
  }

  findDeepest(current);
  if (!deepestCall) return undefined;

  const callSuffix = findChild(deepestCall, "call_suffix");
  return callSuffix ? findChild(callSuffix, "value_arguments") : undefined;
}

// ── Named argument 추출 ───────────────────────────────────────────────────────

/**
 * value_arguments에서 label 이름으로 값 노드를 찾는다.
 * value_argument: [value_argument_label, ":", <expr>]
 */
export function getNamedArg(valueArgs: SyntaxNode, label: string): SyntaxNode | undefined {
  const args = findAllNodes(valueArgs, "value_argument");
  for (const arg of args) {
    const labelNode = findChild(arg, "value_argument_label");
    if (labelNode?.text !== label) continue;
    for (const child of arg.children) {
      if (!child) continue;
      if (child.type === "value_argument_label" || child.type === ":") continue;
      return child;
    }
  }
  return undefined;
}

/**
 * value_arguments에서 첫 번째 positional(label 없는) 인자 값을 가져온다.
 */
export function getPositionalArg(valueArgs: SyntaxNode): SyntaxNode | undefined {
  const args = findAllNodes(valueArgs, "value_argument");
  for (const arg of args) {
    const labelNode = findChild(arg, "value_argument_label");
    if (labelNode) continue; // named arg는 건너뜀
    for (const child of arg.children) {
      if (!child) continue;
      if (child.type === ",") continue;
      return child;
    }
  }
  // value_argument_label 없이 바로 값이 오는 경우
  for (const child of valueArgs.children) {
    if (!child) continue;
    if (child.type === "(" || child.type === ")" || child.type === ",") continue;
    if (child.type === "value_argument") {
      const inner = child.children.find(c => c !== null && c.type !== "," && c.type !== "value_argument_label" && c.type !== ":");
      if (inner) return inner;
    }
  }
  return undefined;
}

// ── 문자열 리터럴 추출 ─────────────────────────────────────────────────────────

export function extractStringLiteral(node: SyntaxNode): string | undefined {
  if (node.type === "line_string_literal") {
    // "Hello" → [", line_str_text, "]
    const textContent = node.children
      .filter(c => c !== null && (c.type === "line_str_text" || c.type === "escaped_identifier"))
      .map(c => c!.text)
      .join("");
    return textContent || node.text.replace(/^"|"$/g, "");
  }
  if (node.type === "multiline_string_literal") {
    return node.text.replace(/^"""|"""$/g, "").trim();
  }
  // 직접 탐색
  const strNode = findAllNodes(node, "line_string_literal")[0];
  if (strNode) return extractStringLiteral(strNode);
  return undefined;
}

// ── 숫자 추출 ────────────────────────────────────────────────────────────────

export function extractNumber(node: SyntaxNode): number | undefined {
  if (node.type === "integer_literal") {
    const n = parseInt(node.text, 10);
    return isNaN(n) ? undefined : n;
  }
  if (node.type === "real_literal") {
    const n = parseFloat(node.text);
    return isNaN(n) ? undefined : n;
  }
  // prefix_expression: - 숫자
  if (node.type === "prefix_expression") {
    const children = node.children.filter(c => c !== null);
    if (children[0]?.text === "-" && children[1]) {
      const n = extractNumber(children[1]);
      return n !== undefined ? -n : undefined;
    }
  }
  // 재귀적으로 찾기
  const intLit = findAllNodes(node, "integer_literal")[0];
  if (intLit) {
    const n = parseInt(intLit.text, 10);
    return isNaN(n) ? undefined : n;
  }
  const realLit = findAllNodes(node, "real_literal")[0];
  if (realLit) {
    const n = parseFloat(realLit.text);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

// ── Color 추출 ────────────────────────────────────────────────────────────────

const SYSTEM_COLOR_MAP: Record<string, string> = {
  "blue": "#007AFF",
  "red": "#FF3B30",
  "green": "#34C759",
  "orange": "#FF9500",
  "purple": "#AF52DE",
  "pink": "#FF2D55",
  "yellow": "#FFCC00",
  "teal": "#5AC8FA",
  "indigo": "#5856D6",
  "gray": "#8E8E93",
  "black": "#000000",
  "white": "#FFFFFF",
  "clear": "transparent",
  "primary": "#000000",    // 근사
  "secondary": "#8E8E93",  // 근사
  "accentColor": "#007AFF",
  "tint": "#007AFF",
};

/**
 * SwiftUI 색상 표현식에서 hex 색상 또는 token: 문자열을 추출한다.
 * 지원: Color.xxx, .xxx, Color("asset"), system colors
 */
export function extractColorFromNode(
  node: SyntaxNode,
  designTokens: Record<string, string>
): string | undefined {
  const text = node.text.trim();

  // Color("LogoColor") — asset colorset
  const assetMatch = text.match(/^Color\s*\(\s*["']([^"']+)["']\s*\)/);
  if (assetMatch) {
    const tokenName = assetMatch[1];
    const tokenKey = `color:${tokenName}`;
    if (designTokens[tokenKey]) return `token:${tokenName}`;
    // designTokens에 직접 등록된 경우
    if (designTokens[tokenName]) return designTokens[tokenName];
    return `token:${tokenName}`;
  }

  // Color(.systemBackground), Color(.systemGroupedBackground) 등 — system semantic
  const semanticMatch = text.match(/^Color\s*\(\s*\.(\w+)\s*\)/);
  if (semanticMatch) {
    // system semantic color는 근사값 반환
    return "#FFFFFF"; // 밝은 모드 기본
  }

  // .blue, .red, .primary, .secondary 등 접두사 없는 Color enum
  const dotColorMatch = text.match(/^\.(\w+)(?:\.opacity\([\d.]+\))?$/);
  if (dotColorMatch) {
    const colorName = dotColorMatch[1];
    if (SYSTEM_COLOR_MAP[colorName]) return SYSTEM_COLOR_MAP[colorName];
  }

  // Color.blue, Color.red 등
  const colorDotMatch = text.match(/^Color\.(\w+)(?:\.opacity\([\d.]+\))?/);
  if (colorDotMatch) {
    const colorName = colorDotMatch[1];
    if (SYSTEM_COLOR_MAP[colorName]) return SYSTEM_COLOR_MAP[colorName];
  }

  // .tint, .primary, .secondary (SwiftUI semantic)
  if (text === ".tint" || text === ".accentColor") return "#007AFF";
  if (text === ".primary") return "#000000";
  if (text === ".secondary") return "#8E8E93";

  // 직접 시스템 컬러명 (navigation_expression 체인에서 오는 경우)
  for (const [name, hex] of Object.entries(SYSTEM_COLOR_MAP)) {
    if (text.endsWith(`.${name}`) || text === name) return hex;
  }

  return undefined;
}

// ── 수정자 체인 스캐너 ─────────────────────────────────────────────────────────

export interface ModifierInfo {
  name: string;
  args: SyntaxNode | undefined;
  fullText: string;
}

/**
 * navigation_expression 체인에서 모든 수정자(modifier) 호출을 추출한다.
 *
 * 예: Text("hi").font(.body).foregroundColor(.blue)
 * → [{name:"font", args:...}, {name:"foregroundColor", args:...}]
 */
export function extractModifiers(node: SyntaxNode): ModifierInfo[] {
  const modifiers: ModifierInfo[] = [];

  /**
   * outerCallSuffix: 상위 call_expression의 call_suffix.
   * Text(...).foregroundStyle(Color(...)) AST 구조:
   *   call_expression
   *     navigation_expression(Text.foregroundStyle)
   *     call_suffix((Color(...)))   ← outerCallSuffix
   * navigation_expression 안의 navigation_suffix(.foregroundStyle)는
   * 자체 children에 call_suffix를 갖지 않고 상위 call_expression의 call_suffix를 공유한다.
   */
  function walk(n: SyntaxNode, outerCallSuffix?: SyntaxNode) {
    if (n.type === "navigation_expression") {
      // 내부 navigation_expression 먼저 재귀
      const innerNav = findChild(n, "navigation_expression");
      const innerCall = findChild(n, "call_expression");
      const inner = innerNav ?? innerCall;
      if (inner) walk(inner);

      // 이 레벨의 navigation_suffix
      const navSuffix = findChild(n, "navigation_suffix");
      if (navSuffix) {
        const modName = findChild(navSuffix, "simple_identifier")?.text;
        if (modName) {
          // 1. navigation_expression 자신의 children에서 call_suffix 탐색
          //    (예: Text.font(.body) — call_suffix가 navigation_expression 자식)
          const children = n.children.filter(c => c !== null);
          const nsIdx = children.findIndex(c => c?.type === "navigation_suffix");
          const nextSib = nsIdx >= 0 ? children[nsIdx + 1] : undefined;
          let valueArgs = nextSib?.type === "call_suffix"
            ? findChild(nextSib, "value_arguments")
            : undefined;

          // 2. 없으면 상위 call_expression의 call_suffix 사용
          //    (예: Text(...).foregroundStyle(Color(...)) — call_suffix가 outer call_expression 자식)
          if (!valueArgs && outerCallSuffix) {
            valueArgs = findChild(outerCallSuffix, "value_arguments");
          }

          modifiers.push({
            name: modName,
            args: valueArgs,
            fullText: n.text,
          });
        }
      }
    } else if (n.type === "call_expression") {
      const navExpr = findChild(n, "navigation_expression");
      if (navExpr) {
        // call_expression의 call_suffix를 inner navigation_expression 처리 시 전달
        const outerSuffix = findChild(n, "call_suffix");
        walk(navExpr, outerSuffix);
      }
    }
  }

  walk(node);
  return modifiers;
}

// ── padding 추출 ──────────────────────────────────────────────────────────────

/**
 * .padding(20), .padding(.horizontal, 20), .padding(.top, 16) 등에서
 * [top, right, bottom, left] 배열을 추출한다.
 */
export function extractPadding(
  modifiers: ModifierInfo[]
): [number, number, number, number] | undefined {
  let top = 0, right = 0, bottom = 0, left = 0;
  let found = false;

  for (const mod of modifiers) {
    if (mod.name !== "padding") continue;
    found = true;

    if (!mod.args) {
      // .padding() — 기본 패딩 (SwiftUI 기본값 ~16)
      top = right = bottom = left = 16;
      continue;
    }

    const text = mod.args.text;

    // .padding(.all, n) or .padding(n)
    const numMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
    const num = numMatch ? parseFloat(numMatch[1]) : 16;

    if (text.includes(".horizontal")) {
      left = right = num;
    } else if (text.includes(".vertical")) {
      top = bottom = num;
    } else if (text.includes(".top")) {
      top = num;
    } else if (text.includes(".bottom")) {
      bottom = num;
    } else if (text.includes(".leading")) {
      left = num;
    } else if (text.includes(".trailing")) {
      right = num;
    } else {
      // positional 숫자 또는 무인수
      top = right = bottom = left = num;
    }
  }

  return found ? [top, right, bottom, left] : undefined;
}

// ── frame 추출 ────────────────────────────────────────────────────────────────

export interface FrameInfo {
  width?: number | "fill";
  height?: number | "fill";
}

export function extractFrame(modifiers: ModifierInfo[]): FrameInfo {
  const result: FrameInfo = {};

  for (const mod of modifiers) {
    if (mod.name !== "frame") continue;
    if (!mod.args) continue;

    const text = mod.args.text;

    if (text.includes("maxWidth: .infinity") || text.includes("maxWidth:.infinity")) {
      result.width = "fill";
    } else {
      const wMatch = text.match(/width:\s*(\d+(?:\.\d+)?)/);
      if (wMatch) result.width = parseFloat(wMatch[1]);
    }

    if (text.includes("maxHeight: .infinity") || text.includes("maxHeight:.infinity")) {
      result.height = "fill";
    } else {
      const hMatch = text.match(/height:\s*(\d+(?:\.\d+)?)/);
      if (hMatch) result.height = parseFloat(hMatch[1]);
    }
  }

  return result;
}

// ── 수정자에서 색상 추출 ──────────────────────────────────────────────────────

export function extractBackgroundFromModifiers(
  modifiers: ModifierInfo[],
  designTokens: Record<string, string>
): string | undefined {
  for (const mod of modifiers) {
    if (mod.name !== "background") continue;
    if (!mod.args) continue;
    const color = extractColorFromModifierArgs(mod.args, designTokens);
    if (color) return color;
  }
  return undefined;
}

export function extractForegroundColorFromModifiers(
  modifiers: ModifierInfo[],
  designTokens: Record<string, string>
): string | undefined {
  for (const mod of modifiers) {
    if (mod.name !== "foregroundColor" && mod.name !== "foregroundStyle") continue;
    if (!mod.args) continue;
    const color = extractColorFromModifierArgs(mod.args, designTokens);
    if (color) return color;
  }
  return undefined;
}

function extractColorFromModifierArgs(
  args: SyntaxNode,
  designTokens: Record<string, string>
): string | undefined {
  // 단순 .blue, Color.red 등
  const positional = findAllNodes(args, "value_argument")[0];
  if (!positional) {
    return extractColorFromNode(args, designTokens);
  }

  const exprNode = positional.children.find(c => c !== null && c.type !== "," && c.type !== "value_argument_label" && c.type !== ":");
  if (exprNode) return extractColorFromNode(exprNode, designTokens);
  return extractColorFromNode(args, designTokens);
}

// ── cornerRadius 추출 ─────────────────────────────────────────────────────────

export function extractCornerRadius(modifiers: ModifierInfo[]): number | undefined {
  for (const mod of modifiers) {
    if (mod.name !== "cornerRadius" && mod.name !== "clipShape") continue;
    if (!mod.args) continue;
    const numMatch = mod.args.text.match(/(\d+(?:\.\d+)?)/);
    if (numMatch) return parseFloat(numMatch[1]);
  }
  return undefined;
}

// ── typography token 추출 ─────────────────────────────────────────────────────

const FONT_TOKEN_MAP: Record<string, string> = {
  "largeTitle": "largeTitle",
  "title": "title",
  "title2": "title2",
  "title3": "title3",
  "headline": "headline",
  "body": "body",
  "callout": "callout",
  "subheadline": "subheadline",
  "footnote": "footnote",
  "caption": "caption",
  "caption2": "caption2",
};

export function extractFontToken(modifiers: ModifierInfo[]): string | undefined {
  for (const mod of modifiers) {
    if (mod.name !== "font") continue;
    if (!mod.args) continue;
    const text = mod.args.text;
    for (const [key, token] of Object.entries(FONT_TOKEN_MAP)) {
      if (text.includes(`.${key}`)) return token;
    }
  }
  return undefined;
}

// ── navigationTitle 추출 ─────────────────────────────────────────────────────

export function extractNavigationTitle(modifiers: ModifierInfo[]): string | undefined {
  for (const mod of modifiers) {
    if (mod.name !== "navigationTitle") continue;
    if (!mod.args) continue;
    return extractStringLiteral(mod.args) ?? mod.args.text.replace(/^[("']|[)"']$/g, "");
  }
  return undefined;
}
